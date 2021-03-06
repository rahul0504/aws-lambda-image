/**
 * Created by Rahul on 23/8/17.
 */
/**
 * Automatic Image resize, reduce with AWS Lambda
 * Lambda main handler
 *
 * @author Yoshiaki Sugimoto
 * @created 2015/10/29
 */
"use strict";

const ImageProcessor = require("./lib/ImageProcessor");
const S3FileSystem   = require("./lib/S3FileSystem");
const eventParser    = require("./lib/EventParser");
const Config         = require("./lib/Config");
const fs             = require("fs");
const path           = require("path");

// Lambda Handler
exports.handler = (event, context, callback) => {
    var eventRecord = eventParser(event);
    if (eventRecord) {
        process(eventRecord, callback);
    } else {
        console.log(JSON.stringify(event));
        callback('Unsupported or invalid event');
        return;
    }
};

function process(s3Object, callback) {
    const configPath = path.resolve(__dirname, "./config.json");
    const fileSystem = new S3FileSystem();
    const processor  = new ImageProcessor(fileSystem, s3Object);
    const config     = new Config(
        JSON.parse(fs.readFileSync(configPath, { encoding: "utf8" }))
    );

    processor.run(config)
        .then((processedImages) => {
        console.log("-----------processed image-------",processedImages)
            callback(null, processedImages);
            return;
        })
        .catch((messages) => {
            if ( messages === "Object was already processed." ) {
                console.log("Image already processed");
                callback("Image already processed",null);
                return;
            } else if ( messages === "Empty file or directory." ) {
                console.log( "Image file is broken or it's a folder" );
                callback("Image file is broken or it's a folder",null);
                return;
            } else {
                console.log("Error message :: ",messages)
                callback(messages,null);
                return;
            }
        });
}
