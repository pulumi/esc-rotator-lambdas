import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as aws from "@pulumi/aws";

// Load configs
const templateConfig = new pulumi.Config("esc-rotator-lambda");
const awsConfig = new pulumi.Config("aws");
const awsRegion = awsConfig.require("region");
const rdsId = templateConfig.require("rdsId");
const lambdaArchiveBucketPrefix = templateConfig.require("lambdaArchiveBucketPrefix");
const lambdaArchiveKey = templateConfig.require("lambdaArchiveKey");
const lambdaArchiveSigningProfileVersionArn = templateConfig.require("lambdaArchiveSigningProfileVersionArn");
const trustedAccount = templateConfig.require("trustedAccount");
const allowlistedEnvironment = templateConfig.get("allowlistedEnvironment") ?? null;

// Retrieve reference to current code artifact from trusted pulumi bucket
const lambdaArchiveBucket = `${lambdaArchiveBucketPrefix}-${awsRegion}`
const codeArtifact = aws.s3.getObjectOutput({bucket: lambdaArchiveBucket, key: lambdaArchiveKey});

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

// Decide whether to create example environment
let externalId: string
let exampleEnvironment : {
    organization: string,
    project: string,
    name: string,
} | null = null;
if (allowlistedEnvironment) {
    externalId = allowlistedEnvironment;
} else {
    exampleEnvironment = {
        organization: pulumi.getOrganization(),
        project: "PulumiEscSecretRotatorLambda",
        name: "ExampleRotator",
    };
    externalId = `${exampleEnvironment.organization}/${exampleEnvironment.project}/${exampleEnvironment.name}-*`;
}

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
if (exampleEnvironment) {
    const randomString = new random.RandomString(namePrefix + "RandomEnvironmentId", {
        keepers: {
            allowlistedEnvironment: assumedRole.name,
        },
        length: 8,
        special: false,
    });
    const rotatorType = databasePort.apply(port => port === 5432 ? "postgres" : "mysql");
    const yaml = pulumi.interpolate
        `values:
           exampleRotator:
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
    const example = new pulumiservice.Environment(namePrefix + "ExampleRotatorEnvironment", {
        organization: exampleEnvironment.organization,
        project: exampleEnvironment.project,
        name: pulumi.interpolate `${exampleEnvironment.name}-${randomString.result}`,
        yaml: yaml,
    })
}

export const lambdaArn = lambda.arn;
export const assumedRoleArn = assumedRole.arn;
