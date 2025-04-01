package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/lib/pq"
)

type PostgresRotateParams struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`

	ManagingUser PostgresUser `json:"managingUser"`
	RotateUser   PostgresUser `json:"rotateUser"`
}

type PostgresUser struct {
	Username    string  `json:"username"`
	Password    string  `json:"password"`
	NewPassword *string `json:"newPassword"`
}

func Rotate(ctx context.Context, request PostgresRotateParams) error {
	db, err := sql.Open("postgres", fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		request.ManagingUser.Username,
		request.ManagingUser.Password,
		request.Host,
		request.Port,
		request.Database,
	))
	if err != nil {
		return err
	}
	defer db.Close()

	if request.RotateUser.NewPassword == nil {
		return fmt.Errorf("no password provided")
	}

	_, err = db.ExecContext(ctx, fmt.Sprintf(`ALTER USER %s WITH PASSWORD %s`,
		pq.QuoteIdentifier(request.RotateUser.Username),
		pq.QuoteLiteral(*request.RotateUser.NewPassword)),
	)
	if err != nil {
		return fmt.Errorf("error rotating user %q: %w", request.RotateUser.Username, err)
	}
	return nil
}
