import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws";
import * as dockerbuild from "@pulumi/docker-build";
import * as path from "path";
import * as child_process from "child_process";

const config = new pulumi.Config()
const distributionRegions = config.getObject<aws.Region[]>("distributionRegions") || []
const githash = child_process.execFileSync("git", ["log", "-n1", "--pretty=%H", "../rotators"], {encoding: "utf8"}).trim()

// Create a signing profile for stamping the lambda archives.
const signingProfile = new aws.signer.SigningProfile("signing-profile", {
    namePrefix: `pulumi_esc_${pulumi.getStack()}_`,
    platformId: "AWSLambda-SHA384-ECDSA",
})

// Use a code signing config referencing this arn to verify lambda archives.
export const signingProfileVersionArn = signingProfile.versionArn;

// Build & upload the lambda archives.
// Use a docker container to build the lambda archive for toolchain consistency.
const builder = new dockerbuild.Image("lambda-builder", {
    context: {
        location: "../rotators/aws-lambda",
    },
    buildArgs: {
        OUTFILE_FILENAME: "lambda-deployment-package.zip",
    },
    exports: [{
        local: {dest: "./build"},
    }],
    // need to build on preview to successfully calculate an asset hash
    buildOnPreview: true,
    push: false,
})

const archive = pulumi.all([builder.buildArgs, builder.exports]).apply(([args, exports]) => {
    return new pulumi.asset.FileAsset(path.join(exports![0].local!.dest, args!["OUTFILE_FILENAME"]))
})

const stagingBucket = new aws.s3.BucketV2(`esc-rotator-lambdas-${pulumi.getStack()}`, {
    forceDestroy: true,
}, {protect: false})

const stagingBucketVersioning = new aws.s3.BucketVersioningV2("staging-bucket-versioning", {
    bucket: stagingBucket.bucket,
    versioningConfiguration: {
        status: "Enabled"
    }
})

const object = new aws.s3.BucketObjectv2("lambda-staged.zip", {
    bucket: stagingBucket.bucket,
    key: pulumi.interpolate`staged/${githash}.zip`,
    source: archive,
}, {retainOnDelete: true})

const signingJob = new aws.signer.SigningJob("lambda-signed.zip", {
    profileName: signingProfile.name,
    source: {
        s3: {
            bucket: object.bucket,
            key: object.key,
            version: object.versionId,
        },
    },
    destination: {
        s3: {
            bucket: stagingBucket.bucket,
            prefix: "signed/"
        }
    },
    ignoreSigningJobFailure: false,
}, {dependsOn: [stagingBucketVersioning]})

const signedArchive = signingJob.signedObjects[0].s3s[0];

// Set up distribution buckets.
// Lambda can only update code from a s3 bucket within its same region, so create buckets in each region to replicate the archives to.
export const distributionBuckets = distributionRegions.map((region, index) => {
    const provider = new aws.Provider(`${region}-provider`, {
        region: region,
    });
    const opts = {provider, parent: provider};

    const distBucket = new aws.s3.BucketV2(`${region}-public-dist-bucket`, {
        bucket: pulumi.interpolate`public-esc-rotator-lambdas-${pulumi.getStack()}-${region}`,
        forceDestroy: true,
    }, opts)

    new aws.s3.BucketVersioningV2(`${region}-dist-bucket-versioning`, {
        bucket: distBucket.bucket,
        versioningConfiguration: {
            status: "Enabled"
        }
    }, opts)

    // Allow public access to these objects
    const allowPublicPolicy = new aws.s3.BucketPublicAccessBlock(`${region}-enable-public-access`, {
        bucket: distBucket.bucket,
        restrictPublicBuckets: false,
    }, opts)

    new aws.s3.BucketPolicy(`${region}-bucket-policy`, {
        bucket: distBucket.bucket,
        policy: {
            Version: "2012-10-17",
            Statement: [
                {
                    Sid: "PublicReadGetObject",
                    Effect: "Allow",
                    Principal: "*",
                    Action: "s3:GetObject",
                    Resource: pulumi.interpolate`${distBucket.arn}/*`,
                },
                {
                    Sid: "RestrictToTLSRequestsOnly",
                    Effect: "Deny",
                    Principal: "*",
                    Action: "s3:*",
                    Resource: pulumi.interpolate`${distBucket.arn}/*`,
                    Condition: {
                        Bool: {
                            "aws:SecureTransport": "false",
                        },
                    },
                }
            ]
        }
    }, {...opts, dependsOn: [allowPublicPolicy]});

    // Replicate the signed archive to this region
    const replica = new aws.s3.ObjectCopy(`${region}-lambda-latest.zip`, {
        source: pulumi.interpolate`${signedArchive.bucket}/${signedArchive.key}`,
        bucket: distBucket.bucket,
        key: "latest.zip",
    }, {...opts, retainOnDelete: true})

    return pulumi.interpolate`https://${distBucket.bucketDomainName}/${replica.key}`
});
