"use strict";

const ImageArchiver = require("./ImageArchiver");
const ImageResizer = require("./ImageResizer");
const ImageReducer = require("./ImageReducer");
const Path = require("path");
const fs = require("fs");
let CACHE_DIR = Path.join(__dirname, '../cache/');
let mkdirp = require("mkdirp");
let getDirName = require("path").dirname;
var mime = require('mime');
const minimumImageSize = 60;

class ImageProcessor {

    /**
     * Image processor
     * management resize/reduce image list by configration,
     * and pipe AWS Lambda's event/context
     *
     * @constructor
     * @param Object fileSystem
     * @param Object s3Object
     */
    constructor(fileSystem, s3Object) {
        this.fileSystem = fileSystem;
        this.s3Object = s3Object;
    }

    /**
     * Run the process
     *
     * @public
     * @param Config config
     */
    run(config) {
        if (!config.get("bucket")) {
            config.set("bucket", this.s3Object.bucket.name);
        }
        var path = config.path = this.s3Object.object.key;
        var arr = path.match(/(.*).(jpg|png|gif|jpeg|JPG|PNG|GIF|JPEG|tif|TIF|tiff|TIFF|webp)/);
        if (!arr) {
            return Promise.reject("Image format not supported");
        }
        var isWebp = config.isWebP = false;
        var cacheThumbnailPath = CACHE_DIR + path;
        path.match(/(.*)\-(\d+)x(\d+).(jpg|png|gif|jpeg|JPG|PNG|GIF|JPEG|tif|TIF|tiff|TIFF|webp)/);
        var arr_new = arr[0].match(/(.*)\-(\d+)x(\d+).(jpg|png|gif|jpeg|JPG|PNG|GIF|JPEG|tif|TIF|tiff|TIFF|webp)/);
        var original = false;
        if (!arr_new) {
            if(path.indexOf("tmp/")>-1){
                return Promise.reject("Image format not supported");
            }
            var originalUrl = arr[0];
            originalUrl = originalUrl.replace("-o", "");
            var width = 2048;
            var height = 2048;
            original = true;
            cacheThumbnailPath = CACHE_DIR + arr[1] + '-' + width + 'x' + height + '.' + arr[2];
        }
        else {
            var originalUrl = arr_new[1] + '.' + arr_new[4];
            var width = parseInt(arr_new[2]);
            var height = parseInt(arr_new[3]);
        }
        console.log("cacheThumbnailPath>>>>", cacheThumbnailPath);
        if (originalUrl && originalUrl.indexOf('/webp/') > -1) {
            originalUrl = originalUrl.replace('webp/', "");
            config.isWebP = isWebp = true;
        }
        var tokens = originalUrl.split('/').slice(2);
        var pendingUpload_url = tokens.join('/');     // ms.products/id/images/---
        var OriginalimageURL = originalUrl.replace(pendingUpload_url, "originals/") + pendingUpload_url;
        if(path.indexOf("tmp/")>-1){
            OriginalimageURL = originalUrl
        }
        config.size = width;
        config.imageLocalPath = cacheThumbnailPath;
        console.log("-------2--- get object", new Date)
        return this.fileSystem.getObject(
            this.s3Object.bucket.name,
            decodeURIComponent(OriginalimageURL.replace(/\+/g, ' '))
            )
            .then((imageData) => this.processImage(imageData, config))
            .then((file)=>Promise.resolve(file))
            ;
    }

    /**
     * Processing image
     *
     * @public
     * @param ImageData imageData
     * @param Config config
     * @return Promise
     */
    processImage(imageData, config) {
        const acl = config.get("acl");
        const bucket = config.get("bucket");
        const jpegOptimizer = config.get("jpegOptimizer", "mozjpeg");
        const optimizerOptions = config.get("optimizers", {});
        let imageLocalPath = config.imageLocalPath;

        let promise = Promise.resolve();
        let processedImages = 0;

        if (config.exists("backup")) {
            const backup = config.get("backup");
            backup.acl = backup.acl || acl;
            backup.bucket = backup.bucket || bucket;

            promise = promise
                .then(() => this.execBackupImage(backup, imageData))
                .then((image) => this.fileSystem.putObject(image))
                .then(() => ( backup.move === true ) ? this.fileSystem.deleteObject(imageData) : Promise.resolve())
                .then(() => Promise.resolve(++processedImages));
        }

        if (config.exists("reduce")) {
            const reduce = config.get("reduce");
            reduce.acl = reduce.acl || acl;
            reduce.bucket = reduce.bucket || bucket;
            reduce.jpegOptimizer = reduce.jpegOptimizer || jpegOptimizer;
            reduce.optimizerOptions = optimizerOptions;

            promise = promise
                .then(() => this.execReduceImage(reduce, imageData))
                .then((image) => this.fileSystem.putObject(image))
                .then(() => Promise.resolve(++processedImages));
        }
        /*let imagesToProcess = config.get("resizes", []).filter((resize) => {
         return resize.size == config.size;
         })*/
        let imagesToProcess = [{'size': config.size}];
        if (!(imagesToProcess.length)) {
            return Promise.reject("Image Size Version not supported")
        }

        imagesToProcess.forEach((resize) => {
            imageData.imageLocalPath = config.imageLocalPath;
            imageData.isWebP = config.isWebP;
            resize.acl = resize.acl || acl;
            resize.bucket = resize.bucket || bucket;
            resize.jpegOptimizer = resize.jpegOptimizer || jpegOptimizer;
            resize.optimizerOptions = optimizerOptions;
            resize.imageLocalPath = config.imageLocalPath;
            promise = promise
                .then(() => this.execResizeImage(resize, imageData))
                .then((image) => {
                    console.log("-------4--- after reduce", new Date)
                    console.log("----imageLocalPath----", imageLocalPath)
                    let ext = Path.extname(image.fileName);
                    image._fileName = config.path;
                    if (config.isWebP) {
                        imageLocalPath = imageLocalPath.replace(ext, ".webp")
                        image._headers.ContentType = "image/webp";
                    }
                    var stats = fs.statSync(imageLocalPath)
                    if (stats.size && stats.size < minimumImageSize) {
                        return Promise.reject("Something went wrong with image")
                    }
                    if (image._fileName.indexOf("monitoring-100x100.jpg") > -1) {
                        return Promise.resolve("image server running");
                    }
                    else {
                        this.fileSystem.putObject(image);
                    }
                    return Promise.resolve(imageLocalPath)
                })
        });
        return promise;
    }

    /**
     * Execute resize image
     *
     * @public
     * @param Object option
     * @param imageData imageData
     * @return Promise
     */
    execResizeImage(option, imageData) {
        const resizer = new ImageResizer(option);

        return resizer.exec(imageData)
            .then((resizedImage) => {
                console.log("-------3--- after resize", new Date)
                console.log("---we are hereee------", resizedImage)
                if (imageData.isWebP) {
                    return Promise.resolve(resizedImage);
                }
                else {
                    const reducer = new ImageReducer(option);
                    return reducer.exec(resizedImage);
                }
            });
    }

    /**
     * Execute reduce image
     *
     * @public
     * @param Object option
     * @param ImageData imageData
     * @return Promise
     */
    execReduceImage(option, imageData) {
        const reducer = new ImageReducer(option);

        return reducer.exec(imageData);
    }

    /**
     * Execute image backup
     *
     * @public
     * @param Object option
     * @param ImageData imageData
     * @return Promise
     */
    execBackupImage(option, imageData) {
        const archiver = new ImageArchiver(option);

        return archiver.exec(imageData);
    }
}

module.exports = ImageProcessor;
