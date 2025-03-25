import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws";

// Create a signing profile for stamping the lambda archives.
const signingProfile = new aws.signer.SigningProfile("signing-profile", {
    namePrefix: `pulumi_esc_${pulumi.getStack()}_`,
    platformId: "AWSLambda-SHA384-ECDSA",
})

// Use a code signing config referencing this arn to verify lambda archives.
export const signingProfileVersionArn = signingProfile.versionArn;

// Create a s3 bucket for staging lambda archives
const stagingBucket = new aws.s3.BucketV2(`esc-rotator-lambdas-${pulumi.getStack()}`, {
    forceDestroy: true,
});

export const stagingBucketName = stagingBucket.bucket;

// AWS signing jobs require bucket versioning
const stagingBucketVersioning = new aws.s3.BucketVersioningV2("staging-bucket-versioning", {
    bucket: stagingBucket.bucket,
    versioningConfiguration: {
        status: "Enabled"
    }
});

// Allow AWS Serverless Application Repo to read from the bucket for distribution
new aws.s3.BucketPolicy("serverlessrepo-distribution", {
    bucket: stagingBucket.bucket,
    policy: {
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Principal: {
                    Service: "serverlessrepo.amazonaws.com"
                },
                Action: "s3:GetObject",
                Resource: pulumi.interpolate`${stagingBucket.arn}/*`,
            }
        ]
    }
});
