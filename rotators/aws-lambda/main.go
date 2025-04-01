package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/pulumi/esc-rotator-lambdas/rotators/aws-lambda/mysql"
	"github.com/pulumi/esc-rotator-lambdas/rotators/aws-lambda/postgres"
)

type response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func dispatch[T any](ctx context.Context, event json.RawMessage, do func(ctx context.Context, req T) error) error {
	var req T
	if err := json.Unmarshal(event, &req); err != nil {
		return err
	}
	return do(ctx, req)
}

func handleRequest(ctx context.Context, event json.RawMessage) (*response, error) {
	var tagged struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(event, &tagged); err != nil {
		return nil, err
	}

	var err error
	switch tagged.Type {
	case "mysql":
		err = dispatch(ctx, event, mysql.Rotate)
	case "postgres":
		err = dispatch(ctx, event, postgres.Rotate)
	default:
		err = fmt.Errorf("unknown event type %s", tagged.Type)
	}

	if err != nil {
		return &response{Code: 400, Message: err.Error()}, nil
	}
	return &response{Code: 200, Message: "ok"}, nil
}

func main() {
	lambda.Start(handleRequest)
}
