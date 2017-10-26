"use strict";

const ImageData = require("./ImageData");
const aws = require("aws-sdk");
const fs = require("fs")

class S3FileSystem {

    constructor() {
        this.client = new aws.S3({apiVersion: "2006-03-01"});
    }

    /**
     * Get object data from S3 bucket
     *
     * @param String bucket
     * @param String key
     * @return Promise
     */
    getObject(bucket, key, acl) {
        return new Promise((resolve, reject) => {
            console.log("Downloading: " + key);

            this.client.getObject({Bucket: bucket, Key: key}).promise().then((data) => {
                if (data.ContentLength <= 0) {
                    reject("Empty file or directory.");
                } else {
                    resolve(new ImageData(
                        key,
                        bucket,
                        data.Body,
                        {ContentType: data.ContentType, CacheControl: data.CacheControl},
                        acl
                    ));
                }
            }).catch((err) => {
                if(key && key.indexOf("originals/")>-1){
                    key = key.replace('originals/','');
                    key = key.replace('webp/','');
                    this.client.getObject({Bucket: bucket, Key: key}).promise().then((data) => {
                        if (data.ContentLength <= 0) {
                            reject("Empty file or directory.");
                        } else {
                            resolve(new ImageData(
                                key,
                                bucket,
                                data.Body,
                                {ContentType: data.ContentType, CacheControl: data.CacheControl},
                                acl
                            ));
                        }
                    }).catch((err) => {
                        console.log("--get image error--",err)
                        reject("Original Image does not exist");
                    });
                }
                else {
                    console.log("--get image error--",err)
                    reject("Original Image does not exist");
                }

               // reject("Original Image does not exist");
            });
        });
    }

    /**
     * Put object data to S3 bucket
     *
     * @param ImageData image
     * @return Promise
     */
    putObject(image) {
        const params = {
            Bucket:       image.bucketName,
            Key:          image.fileName,
            Body:         image.data,
            Metadata:     { "img-processed": "true" },
            ContentType:  image.headers.ContentType,
            ACL:          image.acl || "private",
            CacheControl: "max-age=315619200000,public",
            Expires: new Date(new Date().getTime() + 315619200000)
        };

        console.log("Uploading to: " + params.Key + " (" + params.Body.length + " bytes)");
       /* fs.unlink(image.imageLocalPath, function (err) {
        })*/

        this.client.putObject(params,function(err, data){
            console.log("-err, data-",err, data)
            if (err) {
                console.log('Error while putting object to S3', err);
                require('ms-logger').error(err.message);
            }
        })
    }

    /**
     * Delete object data from S3 bucket
     *
     * @param ImageData image
     * @return Promise
     */
    deleteObject(image) {
        const params = {
            Bucket: image.bucketName,
            Key: image.fileName
        };

        console.log("Delete original object: " + params.Key);

        return this.client.deleteObject(params).promise();
    }
}

module.exports = S3FileSystem;
