import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Load configs
const templateConfig = new pulumi.Config("esc-rotator-lambda");
const awsConfig = new pulumi.Config("aws");
const awsRegion = awsConfig.require("region");
const vpcId = templateConfig.require("vpcId");
const subnetIds = templateConfig.requireObject<string[]>("subnetIds");
const databaseSecurityGroupId = templateConfig.require("databaseSecurityGroupId");
const databasePort = templateConfig.requireNumber("databasePort");
const lambdaArchiveBucketPrefix = templateConfig.require("lambdaArchiveBucketPrefix");
const lambdaArchiveKey = templateConfig.require("lambdaArchiveKey");
const lambdaArchiveSigningProfileVersionArn = templateConfig.require("lambdaArchiveSigningProfileVersionArn");
const trustedAccount = templateConfig.require("trustedAccount");
const externalId = templateConfig.require("externalId");

// Retrieve code artifact from trusted pulumi bucket 
const lambdaArchiveBucket = `${lambdaArchiveBucketPrefix}-${awsRegion}`
const codeArtifact = aws.s3.getObjectOutput({bucket: lambdaArchiveBucket, key: lambdaArchiveKey});

// Create resources
const namePrefix = "PulumiEscSecretRotatorLambda-"
const codeSigningConfig = new aws.lambda.CodeSigningConfig(namePrefix + "CodeSigningConfig", {
    description: "Pulumi ESC rotator-lambda signature - https://github.com/pulumi/esc-rotator-lambdas",
    allowedPublishers: {
        signingProfileVersionArns: [lambdaArchiveSigningProfileVersionArn],
    },
    policies: {
        untrustedArtifactOnDeployment: "Enforce",
    },
});
const lambdaExecRole = new aws.iam.Role(namePrefix + "ExecutionRole", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Service: "lambda.amazonaws.com",
            },
        }],
    }),
    managedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"],
});
const lambdaSecurityGroup = new aws.ec2.SecurityGroup(namePrefix + "SecurityGroup", {
    vpcId: vpcId,
    description: "Security group for Pulumi ESC rotation lambda",
});
const lambdaEgressRule = new aws.ec2.SecurityGroupRule(namePrefix + "ToDatabaseEgressRule", {
    description: "Allow connections to database",
    type: "egress",
    protocol: "tcp",
    fromPort: databasePort,
    toPort: databasePort,
    securityGroupId: lambdaSecurityGroup.id,
    sourceSecurityGroupId: databaseSecurityGroupId,
});
const databaseIngressRule = new aws.ec2.SecurityGroupRule(namePrefix + "FromDatabaseIngressRule", {
    description: "Allow connections from rotation lambda",
    type: "ingress",
    protocol: "tcp",
    fromPort: databasePort,
    toPort: databasePort,
    sourceSecurityGroupId: lambdaSecurityGroup.id,
    securityGroupId: databaseSecurityGroupId,
});
const lambda = new aws.lambda.Function(namePrefix + "Function", {
    description: "The rotator lambda proxies a secret rotation request from Pulumi ESC to a service within your VPC.",
    s3Bucket: codeArtifact.bucket,
    s3Key: codeArtifact.key,
    s3ObjectVersion: codeArtifact.versionId,
    codeSigningConfigArn: codeSigningConfig.arn,
    runtime: "provided.al2023",
    handler: "bootstrap",
    role: lambdaExecRole.arn,
    vpcConfig: {
        subnetIds: subnetIds,
        securityGroupIds: [lambdaSecurityGroup.id],
    },
});
const assumedRole = new aws.iam.Role(namePrefix + "InvocationRole", {
    description: "Allow Pulumi ESC to invoke/manage the rotator lambda",
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                AWS: trustedAccount,
            },
            Condition: {
                StringLike: {
                    "sts:ExternalId": externalId,
                },
            },
        }],
    }),
    inlinePolicies: [{
        policy: pulumi.jsonStringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Sid: "AllowPulumiToInvokeLambda",
                    Effect: "Allow",
                    Action: [
                        "lambda:GetFunction",
                        "lambda:InvokeFunction",
                    ],
                    Resource: lambda.arn,
                },
                {
                    Sid: "AllowPulumiToUpdateLambda",
                    Effect: "Allow",
                    Action: "lambda:UpdateFunctionCode",
                    Resource: lambda.arn,
                },
                {
                    Sid: "AllowPulumiToFetchUpdatedLambdaArchives",
                    Effect: "Allow",
                    Action: "s3:GetObject",
                    Resource: `arn:aws:s3:::${lambdaArchiveBucket}/*`,
                },
            ],
        }),
    }],
});
export const lambdaArn = lambda.arn;
export const assumedRoleArn = assumedRole.arn;
