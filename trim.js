let async = require("async");
let AWS = require("aws-sdk");
let gm = require("gm").subClass({imageMagick: true});
let fs = require("fs");
let mktemp = require("mktemp");
let request = require("request");
const Prmoise = require("bluebird");
const getPageCount = require('docx-pdf-pagecount');

var utils = {
  decodeKey: function(key) {
    return decodeURIComponent(key).replace(/\+/g, ' ');
  }
};

var s3 = new AWS.S3();
var lambda = new AWS.Lambda();

exports.handler = function(event, context, callback) {

  var bucket = event.Records[0].s3.bucket.name,
  srcKey = utils.decodeKey(event.Records[0].s3.object.key),
  dstPrefix = srcKey.replace(/\.\w+$/, "") ,
  fileType = srcKey.slice(-3, srcKey.length);
  var promises = [];
  var folderName = 'upload/';
  
  console.log('FileType:::', fileType);
  console.log('FileName:::', dstPrefix);
  
  if (!fileType || fileType != 'pdf') {
    var msg = "Invalid filetype found for key: " + srcKey;
    callback(msg);
    return;
  }

  startUp();

  function getAccessToken() {

    let clientId = System.getenv('Client_Identifier');
    let params = {
      FunctionName: 'apiGWandFunctionalToken_Lambda',
      InvocationType: 'RequestResponse',
      LogType: 'Tail',
      Payload: '{ "cadalys_planogram_sfdc" : ' + clientId + ' }',
    };
    
    return new Promise((resolve, reject)=> {
      lambda.invoke(params, function(err, data) {
        if (err) {
          reject('Err While get the accessToken ' + err);
        } else {
          resolve(JSON.parse(data.Payload));
        }
      });
    });
  }
  
  function uploadImage(fileName, body, parentId, accToken, fileKey) {
    
    return new Promise((resolve,reject)=>{
      let postData = {
        ParentId    : parentId,
        ContentType :"image/jpeg",
        Name        : fileName,
        Body        : body
      }
      let headers = { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accToken,
      };
      let options = {
          method    : 'POST',
          json      : true,   
          body      : postData,
          url       : 'https://lorealusa--CPDFix.cs70.my.salesforce.com/services/data/v42.0/sobjects/Attachment',
          headers   : headers
      }
      request(options, function (err, res, body) {
        if (err) {
          reject({
            'isUploaded' : false,
            'errorMessage' : err,
            'fileKey' : fileKey
          })
        } else {
          // File Uploading successed.
          if (res.body.success && res.body.success == true) {
            resolve({
              'fileKey' : fileKey,
              'fileName' : fileName,
              'isUploaded': true
            });
          } else {
              resolve({
                'isUploaded' : false,
                'fileName' : fileName,
                'fileKey' : fileKey,
                'errorMessage' : res.body[0].message
            });
          }
        }
      });
    });
  }

  function deleteS3File(bucketName, fileName) {

    return new Promise( (resolve, reject)=>{
      s3.deleteObject({
          Bucket: bucketName,
          Key: fileName
        }, function (err, data) {
        if (data) {
          resolve("File deleted successfully");
        }
        else {
          reject("Check if you have sufficient permissions : "+err);
        }
      });  
    });
  }

  function uploadToBucket(bucketName, fileKey, bodyData) {
    return new Promise((resolve, reject)=>{
      s3.putObject({
          Bucket: bucketName,
          Key: fileKey,
          Body: bodyData,
          ContentType: "image/jpeg",
          Metadata: {
            thumbnail: 'TRUE'
          }
      }, function(err, result) {
          if(err){
            reject(err);
          } else {
            let imageName = fileKey;
            resolve(imageName);
          }
      })
    });
  }
  
  function getFileFromBucket(bucketName, fileKey) {
    return new Promise((resolve, reject)=>{
      s3.getObject({
        Bucket : bucketName,
        Key : fileKey
      }, (err, res)=> {
        if(err) {
          reject(err);
        } else {
          res['Key'] = fileKey;
          resolve(res);
        }
      });
    });
  }
  
  function handleErrorFiles(fileKeys, jsonResult, errorMessage) {
    return new Promise((resolve, reject)=>{
      fileKeys.map(fileKey=>{
        let splitFileName     = fileKey.split('/');
        let fileName          =  splitFileName[1];
        jsonResult[fileName]  = errorMessage;
      });

      uploadToBucket(bucket, folderName + 'result', JSON.stringify(jsonResult)).then(res=>{
        resolve('Err Files Handeled successed');
      }, err=>{
        reject('Err ' + err);
      })
    });
  }

  function getParentId(value, accessToken) {

    return new Promise((resolve, reject)=>{
      let query =  'SELECT Id, ColumnCount__c FROM StorePlanogram__c WHERE POGFilename__c = \'' + value + '\' LIMIT 1';

      let headers = { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + accessToken,
      };
      
      let options = {
          method    : 'GET',
          json      : true,   
          url       : 'https://lorealusa--CPDFix.cs70.my.salesforce.com/services/data/v42.0/query?q=' + query,
          headers   : headers
      }
      
      request(options, (err, res, body)=>{
        if(err) {
          reject('Err While getting the parent id' + err);
        } else {
          if (res.statusCode == 200) {
            if (res.body.records.length > 0) {
              resolve(res.body.records[0]);
            } else {
              reject('There is no record found for the value');
            }
          } else {
            reject(res.body[0].message);
          }
        }
      });
    });
  }
  
  function getAllFilesFromBucketFolder(bucketName, folderName) {
    return new Promise((resolve, reject)=>{
      s3.listObjectsV2({
        Bucket: bucketName,
        Prefix: folderName,
      }, (err, res)=>{
        if (err) {
          reject(err);
        } else {
          resolve(res);
        }
      });
    });
  }

  function uploadAllImagesToSalesForce(imageProperty) {

    return new Promise((resolve, reject)=>{

      let getFilesPropertyPromise = [];
      let uploadImagesPromise = [];
      let fileKeys = [];

      imageProperty.map(file=> {
        getFilesPropertyPromise.push(getFileFromBucket(bucket, file.Key));
        fileKeys.push(file.Key);
      });
      
      // check Folder has error files
      if (getFilesPropertyPromise.length > 0) {

        // get JSON Result file 
        getFileFromBucket(bucket, folderName + 'result').then(jsonRes=>{
          
          // convert file result(binary-value) to json
          let baseStr = Buffer.from(jsonRes.Body).toString('base64');
          let jsonStr = jsonRes.Body.toString('utf-8');
          let jsonResult = JSON.parse(jsonStr);

          // getAccessToken
          getAccessToken().then(accessToken => {

            // get the parent Id by PDF name 
            getParentId(dstPrefix, accessToken).then(parent=>{

              // get files property from bucket
              Promise.all(getFilesPropertyPromise).then(filesProperties=>{
                filesProperties.map( fileProperty => {
                  let splitImageName = (fileProperty.Key).split('/');
                  let imageFileName = splitImageName[1];
                  let body = Buffer.from(fileProperty.Body).toString('base64');
                  uploadImagesPromise.push(uploadImage(imageFileName, body, parent.Id, accessToken, fileProperty.Key));                
                });
  
                // upload images from bucket to salesforce. 
                Promise.all(uploadImagesPromise).then(uploadRes=>{
                  
                  let deleteS3FilePromise = [];

                  // check if images are upload to salesforce or not
                  uploadRes.map(res=> {
                    if(res.isUploaded) {
                      deleteS3FilePromise.push(deleteS3File(bucket, res.fileKey));
                    } else {
                      jsonResult[res.fileKey] = 'File Upload Failed Due to ' + res.errorMessage;
                    }
                  });

                  // delete successfully uploaded images from bucket 
                  Promise.all(deleteS3FilePromise).then(deletedFileRes=> {
                    deletedFileRes.map(delFile=>{
                      let splitImageName = (delFile).split('/');
                      let imageFileName = splitImageName[1];
                      jsonResult[imageFileName] = 'File upload successed';
                    });
                    
                    //upload result file to bucket.
                    uploadToBucket(bucket, folderName + 'result', JSON.stringify(jsonResult)).then(res=>{
                      // next method will be called here
                      resolve('All Images uploaded to Salesforce successed');
                    });

                  });
                }, uploadingErr=>{
                  console.log('Err while upload image to salesforce', uploadingErr);
                });
              }, getFilePropertyErr => {
                console.log('Err while getting the files property', getFilePropertyErr);
              });
            }, getParentErr => {
                console.log('Err While get the parentId ', getParentErr);
                handleErrorFiles(fileKeys, jsonResult, 'Err While get the parentId ' + getParentErr).then(result=>{
                  // next method will be called here
                  resolve('All Images uploaded to Salesforce successed');
              });
            });
          }, tokenErr => {
            console.log('Err While getting the Salesforce AccessToken ', tokenErr);
            handleErrorFiles(fileKeys, jsonResult, 'Err While getting the Salesforce AccessToken ' + tokenErr).then(result=>{
              // next method will be called here
              resolve('All Images uploaded to Salesforce successed');
            });
          });
        });
      } else {
        // next method will be called here
        resolve('All Images to uploaded Salesforce successed');
      }
    });  
  }

  function startUp() {    

    // get File Keys from the bucket 
    getAllFilesFromBucketFolder(bucket, folderName).then(res=>{
        uploadAllImagesToSalesForce(res.Contents).then(uploadRes=>{
          downloadPDFFromBucket();
        });
      }
    );
  }

  function downloadPDFFromBucket() {
    console.log('Name of the pdf::::', srcKey);
    getFileFromBucket(bucket, srcKey).then(res=>{
      getConvertImagePageNumber(res);
    }, err=> {
      console.log('Err While Get PDF file from the bucket', err);
    })
  }

  function getConvertImagePageNumber(response) {
    getAccessToken().then(accessToken=>{
      getParentId(dstPrefix, accessToken).then(parent=>{
        convertFile(response, parent.ColumnCount__c);
      });
    });
  }


  function convertFile(response, pageCount) {
    
    if (response.ContentType != 'application/pdf') {
      var msg = "This file isn't a PDF."
      console.error(msg);
      callback(msg);
      throw msg;
    }

    var temp_file = mktemp.createFileSync("./testUpload/XXXXXXXX.pdf");
    fs.writeFileSync(temp_file, response.Body);

    getPageCount(temp_file)
    .then(totPages => {
      let fromPage = totPages - pageCount;
      var pages = '[' + fromPage + '-' + totPages + ']';
      var gmFile = gm(temp_file + pages); 
      gmFile.size(function(err, size) {
      this.density(144).borderColor('white').border(0, 0).setFormat("jpeg")
          .quality(100).adjoin().trim().write("./testUpload/page%06d", function(err) {
        if(temp_file) {
            fs.unlinkSync(temp_file);
        }
        if (err) {
          console.error(err);
        } else {
          console.log('the images has been extrated.')
        }
        uploadAllPages();
      });
    });
    })
    .catch((err) => {
      console.log(err);
    });

    
  }
    
  function uploadAllPages() {
    fs.readdir('./testUpload/', function(err, files) {
    async.forEachOf(files, function(value, key, callback) {
      fs.readFile('./testUpload/' + value, function(err, data) {
        if (err) {
          console.error(err);
        }
        promises.push(uploadToBucket(bucket, (folderName + dstPrefix + value), data));
        callback();
      });
    }, function(err) {
        if (err) {
          console.log('error:::', err);
        }
        else {
          // upload converte images to s3 butget
          Prmoise.all(promises).then(function(uploadImageRes) {

            let imageProperties = [];

            uploadImageRes.map(imageProperty=>{
              imageProperties.push({
                Key : imageProperty
              });
            });
            
            uploadAllImagesToSalesForce(imageProperties).then(res=>{
              console.log(res);
            });
          }, putFileErr => {
            console.log('Err while upload the image to bucket ' + putFileErr);
          });
        }
      });
    });
  }
};
