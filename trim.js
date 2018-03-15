var async = require("async");
var AWS = require("aws-sdk");
var gm = require("gm").subClass({imageMagick: true});
var fs = require("fs");
var mktemp = require("mktemp");

var utils = {
  decodeKey: function(key) {
    return decodeURIComponent(key).replace(/\+/g, ' ');
  }
};

var s3 = new AWS.S3();

exports.handler = function(event, context, callback) {
      
  var bucket = event.Records[0].s3.bucket.name,
  srcKey = utils.decodeKey(event.Records[0].s3.object.key),
  dstPrefix = srcKey.replace(/\.\w+$/, "") + '/',
  fileType = srcKey.slice(-3, srcKey.length);

  if (!fileType || fileType != 'pdf') {
    var msg = "Invalid filetype found for key: " + srcKey;
    callback(msg);
    return;
  }
  
  console.log('starting the convertion process...');

  function upload(data, filename) {
    console.time("upload");
    s3.putObject({
      Bucket: bucket,
      Key: dstPrefix + filename,
      Body: data,
      ContentType: "image/jpeg",
      Metadata: {
        thumbnail: 'TRUE'
      }
    }, function(err, data) {
      console.timeEnd("upload");
      if (err) {
        console.error(err);
        return;
      }
      console.log('file ' + filename + ' was uploaded.');
    });
  }

  function uploadAllPages() {
    console.time("readdir");
    fs.readdir('/tmp', function(err, files) {
      console.timeEnd("readdir");
      console.log(files.length + ' was generated: ' + files);
      async.forEachOf(files, function(value, key, callback) {
        console.log("readFile");
        fs.readFile('/tmp/' + value, function(err, data) {
          console.log("readFile:::::");
          if (err) {
            console.error(err);
            return;
          }
          upload(data, value);
        });
        
      }, function(err) {
          if (err) {
              callback(err)
          } else {
              console.log('process completed');
              context.done();
          }
      });
    });
  }

  async.waterfall([

    function download(next) {
      console.time("download");
      //Download the image from S3
      s3.getObject({
        Bucket: bucket,
        Key: srcKey
      }, next);
    },

    function convertFile(response, next) {
      console.timeEnd("download");
      if (response.ContentType != 'application/pdf') {
        var msg = "This file isn't a PDF."
        console.error(msg);
        callback(msg);
        throw msg;
      }

      var temp_file = mktemp.createFileSync("/tmp/XXXXXXXXXX.pdf")
      fs.writeFileSync(temp_file, response.Body);
      var gmFile = gm(temp_file + '[18-20]'); 

      console.time("size");
      gmFile.size(function(err, size) {
        console.timeEnd("size");
       

        console.log('Generating the images...');

        console.time("resize");
        this.density(144).borderColor('white').border(0, 0).setFormat("jpeg")
            .quality(100).adjoin().trim().write("/tmp/page%06d", function(err) {
          console.timeEnd("resize");
          if(temp_file) {
             fs.unlinkSync(temp_file);
          }
          if (err) {
            console.error(err);
          } else {
            console.log('the images has been extrated.')
          }
          next(err);
        });
      });
    }
  ], function(err) {
        if (err) {
          console.error(
            "Unable to generate the pages for '" + bucket + "/" + srcKey + "'" +
            " due to error: " + err
            );
        } else {
          console.log("Created pages for '" + bucket + "/" + srcKey + "'");
          uploadAllPages();
        }
  });
};