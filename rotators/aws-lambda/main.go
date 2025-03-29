package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/pulumi/esc-rotator-lambdas/rotators/aws-lambda/mysql"
	"github.com/pulumi/esc-rotator-lambdas/rotators/aws-lambda/postgres"
)

func dispatch[T any](ctx context.Context, event json.RawMessage, do func(ctx context.Context, req T) error) error {
	var req T
	if err := json.Unmarshal(event, &req); err != nil {
		return err
	}
	return do(ctx, req)
}

func handleRequest(ctx context.Context, event json.RawMessage) error {
	var tagged struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(event, &tagged); err != nil {
		return err
	}

	switch tagged.Type {
	case "mysql":
		return dispatch(ctx, event, mysql.Rotate)
	case "postgres":
		return dispatch(ctx, event, postgres.Rotate)
	default:
		return fmt.Errorf("unknown event type %s", tagged.Type)
	}
}

func main() {
	lambda.Start(handleRequest)
}
