import * as pulumi from "@pulumi/pulumi";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as aws from "@pulumi/aws";

const ARCHIVE_BUCKET_PREFIX = "public-esc-rotator-lambdas-production";
const ARCHIVE_KEY = "aws-lambda/latest.zip";
const ARCHIVE_SIGNING_PROFILE_VERSION_ARN = "arn:aws:signer:us-west-2:388588623842:/signing-profiles/pulumi_esc_production_20250325212043887700000001/jva5X9nqMa";
const TRUSTED_PULUMI_ACCOUNT = "arn:aws:iam::058607598222:root";

// Load configs
const templateConfig = new pulumi.Config("esc-rotator-lambda");
const awsConfig = new pulumi.Config("aws");
const awsRegion = awsConfig.require("region");
const rdsId = templateConfig.require("rdsId");
const environmentName = templateConfig.require("environmentName");
const allowlistedEnvironment = templateConfig.get("allowlistedEnvironment") ?? pulumi.getOrganization()+"/*";

// Parse environment name
const envNameSplit = environmentName.split("/");
if (envNameSplit.length != 2) {
    throw Error(`Invalid environmentName supplied "${environmentName}" - needs to be in format "myProject/myEnvironment"`)
}
const environment = {
    organization: pulumi.getOrganization(),
    project: envNameSplit[0],
    name: envNameSplit[1],
};

// Retrieve reference to current code artifact from trusted pulumi bucket
const lambdaArchiveBucket = `${ARCHIVE_BUCKET_PREFIX}-${awsRegion}`
const codeArtifact = aws.s3.getObjectOutput({bucket: lambdaArchiveBucket, key: ARCHIVE_KEY});

// Introspect RDS to discover network settings
const database = aws.rds.getClusterOutput({
    clusterIdentifier: rdsId,
});
const subnetGroup = aws.rds.getSubnetGroupOutput({
    name: database.dbSubnetGroupName,
});
const databaseSecurityGroupId = database.vpcSecurityGroupIds[0];
const databasePort = database.port;
const vpcId = subnetGroup.vpcId;
let validatedSubnetIds = subnetGroup.subnetIds.apply(async ids => {
    let subnetIds: string[] = [];
    for (const id of ids) {
        await aws.ec2.getSubnet({id: id}, {async: false}).then(
            _ => subnetIds.push(id),
            _ => console.log("bad subnet found: "+id),
        );
    }
    return subnetIds;
});

// Create resources
const namePrefix = "PulumiEscSecretRotatorLambda-"
const codeSigningConfig = new aws.lambda.CodeSigningConfig(namePrefix + "CodeSigningConfig", {
    description: "Pulumi ESC rotator-lambda signature - https://github.com/pulumi/esc-rotator-lambdas",
    allowedPublishers: {
        signingProfileVersionArns: [ARCHIVE_SIGNING_PROFILE_VERSION_ARN],
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
        subnetIds: validatedSubnetIds,
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
                AWS: TRUSTED_PULUMI_ACCOUNT,
            },
            Condition: {
                StringLike: {
                    "sts:ExternalId": allowlistedEnvironment,
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
const rotatorType = databasePort.apply(port => port === 5432 ? "postgres" : "mysql");
const yaml = pulumi.interpolate
    `values:
       dbRotator:
         fn::rotate::${rotatorType}:
           inputs:
             database:
               connector:
                 awsLambda:
                   roleArn: ${assumedRole.arn}
                   lambdaArn: ${lambda.arn}
               database: rotator_db # Replace with your DB name
               host: ${database.endpoint}
               port: ${databasePort}
               managingUser:
                 username: managing_user # Replace with your user value
                 password: manager_password # Replace with your user value behind fn::secret
             rotateUsers:
               username1: user1 # Replace with your user value
               username2: user2 # Replace with your user value`
const _ = new pulumiservice.Environment(namePrefix + "RotatorEnvironment", {
    organization: environment.organization,
    project: environment.project,
    name: environment.name,
    yaml: yaml,
}, {
    deleteBeforeReplace: true,
})

export const lambdaArn = lambda.arn;
export const assumedRoleArn = assumedRole.arn;
