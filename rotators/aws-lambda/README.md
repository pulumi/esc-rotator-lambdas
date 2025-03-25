
sam build \
    --use-container

sam package \
    --signing-profiles ESCRotationProxyLambda=pulumi_esc_dev_20250321013308505700000001 \
    --s3-bucket esc-rotator-lambdas-dev-f5c6d79 \
    --output-template-file packaged.yaml

sam publish \
    --template packaged.yaml \
    --region us-west-2
