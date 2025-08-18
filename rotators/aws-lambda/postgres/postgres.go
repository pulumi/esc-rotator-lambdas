package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"

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
	u := &url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(request.ManagingUser.Username, request.ManagingUser.Password),
		Host:     fmt.Sprintf("%s:%d", request.Host, request.Port),
		Path:     request.Database,
		RawQuery: "sslmode=disable",
	}

	db, err := sql.Open("postgres", u.String())
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
