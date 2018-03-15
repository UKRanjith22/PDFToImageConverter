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
5. Select trim.js & node_modules folder and create a zip file
6. In AWS, create a lambda function and upload this zip, Chnage the HandlerInfo name to 
```trim.Handler``` 
7. In the designer section, add trigger S3 bucket to your AWS lambda fucntion 
8. Now when ever you upload a file to bucket, you can see the new folder with converted images

