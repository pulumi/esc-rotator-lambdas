[![Deploy this lambda with Pulumi](https://pulumi.com/images/deploy-with-pulumi/dark.svg)](https://app.pulumi.com/new?template=https://github.com/pulumi/esc-rotator-lambdas/blob/main/deploy/README.md#gh-light-mode-only)
[![Deploy this lambda with Pulumi](https://pulumi.com/images/deploy-with-pulumi/light.svg)](https://app.pulumi.com/new?template=https://github.com/pulumi/esc-rotator-lambdas/blob/main/deploy/README.md#gh-dark-mode-only)

# ESC Rotator Lambda for Database Credential Rotation

This document explains the AWS resources deployed by the `esc-rotator-lambda` Pulumi program and provides step-by-step instructions for manual deployment if needed.

## Overview

The ESC Rotator Lambda acts as a secure proxy for database credential rotation within your VPC. 
It enables Pulumi ESC to safely rotate database credentials without exposing your database to external networks. 

## Resources Deployed

This Pulumi program deploys the following AWS resources:

1. **Lambda Function** - Serves as a proxy for credential rotation operations
2. **Code Signing Configuration** - Verifies the integrity and authenticity of the deployed code
3. **Security Group Rules** - Enables network access between the Lambda and database
4. **Assumed Role** - Allows Pulumi ESC to invoke the Lambda

## Configuration Parameters

| Parameter                               | Description                                                         |
|-----------------------------------------|---------------------------------------------------------------------|
| `aws:region`                            | AWS region for deployment                                           |
| `vpcId`                                 | VPC where Lambda will be deployed                                   |
| `subnetIds`                             | Subnets where Lambda will be deployed (private subnets recommended) |
| `databaseSecurityGroupId`               | Security group ID of the database requiring access                  |
| `databasePort`                          | Database port (default: 3306 for MySQL)                             |
| `lambdaArchiveBucketPrefix`             | Regional S3 bucket prefix containing the Lambda code                |
| `lambdaArchiveKey`                      | S3 key for the Lambda code archive                                  |
| `lambdaArchiveSigningProfileVersionArn` | ARN of signing profile for code verification                        |
| `trustedAccount`                        | The Pulumi ESC AWS account allowed to invoke the Lambda             |

## Manual Deployment Steps

If you prefer to deploy these resources manually rather than using Pulumi, follow these steps:

### 1. Configure Security Groups

Enable network access so the Lambda will be able to connect to your database.

1. Create a security group for the Lambda and allow it to connect to your database:
   - VPC: Your target VPC
   - Description: "Security group for Pulumi ESC rotation lambda"
   - Outgoing rule:
     - Type: Custom TCP
     - Port: Your database port (e.g., 3306)
     - Destination: Your database security group

2. Update your database's security group to allow incoming connections from the Lambda:
   - Incoming rule:
     - Type: Custom TCP
     - Port: Your database port (e.g., 3306)
     - Source: The Lambda security group

### 2. Install the Lambda Function

Deploy the code that will handle credential rotation requests within your VPC.

1. Navigate to the Lambda console and create a new function
2. Basic settings:
    - Runtime: Node.js 22.x
    - Execution role: Create a new role with basic Lambda execution permissions

3. Advanced settings:
    - Enable VPC: Yes
    - VPC: Your target VPC
    - Subnets: Select private subnets
    - Security groups: Select the Lambda security group created earlier

4. Code signing (create inline during Lambda setup):
    - Enable code signing
    - Signing profile: Use ESC's profile ARN: `arn:aws:signer:us-west-2:388588623842:/signing-profiles/pulumi_esc_production_20250325212043887700000001/jva5X9nqMa`
    - Signing policy: Enforce

5. Code source:
    - Amazon S3 location
    - Use the S3 Bucket for your region: `public-esc-rotator-lambdas-production-{region}`: 
      - For example: `https://public-esc-rotator-lambdas-production-us-west-2.s3.us-west-2.amazonaws.com/aws-lambda/latest.zip`
    - S3 Key: `aws-lambda/latest.zip`
    - Handler: `index.handler`

Take note of the lambda's arn.

### 3. Create Assumed Role for ESC

Allow Pulumi ESC to securely invoke the Lambda

1. In IAM, create a new role:
    - Name: `PulumiESCRotatorLambdaInvocationRole`
    - Trust relationship: Allow Pulumi's AWS account id (`058607598222`) to assume this role.
    - Add a ExternalId condition on the role containing the environment slug that will be allowed to use the rotator.
      Pulumi will use an [external id](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html
      containing the originating ESC environment name when assuming this role: `{pulumi organization}/{esc project}/{esc env name}`.
      If you choose, use `StringLike` in the condition to use a wildcard for matching multiple environments.

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Action": "sts:AssumeRole",
         "Effect": "Allow",
         "Principal": {
           "AWS": "arn:aws:iam::058607598222:root"
         },
         "Condition": {
           "StringEquals": {
             "sts:ExternalId": "{fully qualified ESC environment allowed to use the rotator}"
            }
         }
       }
     ]
   }
   ```

2. Add an inline policy granting Lambda invocation and update permissions to the ARN of the Lambda you deployed
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowPulumiToInvokeLambda",
         "Effect": "Allow",
         "Action": [
           "lambda:GetFunction",
           "lambda:InvokeFunction"
         ],
         "Resource": "arn:aws:lambda:{region}:{account-id}:function:{lambda-name}"
       },
       {
         "Sid": "AllowPulumiToUpdateLambda",
         "Effect": "Allow",
         "Action": "lambda:UpdateFunctionCode",
         "Resource": "arn:aws:lambda:{region}:{account-id}:function:{lambda-name}"
       },
       {
         "Sid": "AllowPulumiToFetchUpdatedLambdaArchives",
         "Effect": "Allow",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::public-esc-rotator-lambdas-production-{region}/*"
       }
     ]
   }
   ```

Take note of the role's ARN.

### 4. Configure ESC

Using the ARN of the Lambda, and the ARN of the assumed-role, you can now configure ESC to invoke the lambda to rotate a database credential
