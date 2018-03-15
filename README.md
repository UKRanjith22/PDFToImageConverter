1. Download trim.js
2. Open terminal, Enter 
```
cd AWS-trim

```
3. Now enter following code in terminal 
```
npm install async gm fs mktemp

```
4. The AWS Lambda runtime already has the AWS SDK for JavaScript in Node.js, So we don't need to install AWS SDK
5. Select `trim.js & node_modules` folder and create a zip file
6. In AWS, create a lambda function and upload this zip in `Function code` section, Change the HandlerInfo name to 
```trim.Handler``` 
7. In the designer section, add trigger S3 bucket to your AWS lambda function 
8. Now when ever you upload a file to bucket, you can see the new folder with converted images
9. Following is an example test event, (update s3 bucket name, key, file size & file etag )

```
{
  "Records": [
    {
      "eventVersion": "2.0",
      "eventSource": "aws:s3",
      "awsRegion": "us-west-2",
      "eventTime": "1970-01-01T00:00:00.000Z",
      "eventName": "ObjectCreated:Put",
      "userIdentity": {
        "principalId": "AIDAJDPLRKLG7UEXAMPLE"
      },
      "requestParameters": {
        "sourceIPAddress": "127.0.0.1"
      },
      "responseElements": {
        "x-amz-request-id": "C3D13FE58DE4C810",
        "x-amz-id-2": "FMyUVURIY8/IgAtTv8xRjskZQpcIZ9KG4V5Wp6S7S/JRWeUWerMUE5JgHvANOjpD"
      },
      "s3": {
        "s3SchemaVersion": "1.0",
        "configurationId": "testConfigRule",
        "bucket": {
          "name": "source-ss",
          "ownerIdentity": {
            "principalId": "A3NL1KOZZKExample"
          },
          "arn": "arn:aws:s3:::source-ss"
        },
        "object": {
          "key": "Planogram.pdf",
          "size": 5820944,
          "eTag": "568ac2228e8f849b8833fac3272ca34e",
          "versionId": "096fKKXTRTtl3on89fVO.nfljtsv6qko"
        }
      }
    }
  ]
}

```

