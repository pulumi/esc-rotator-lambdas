package postgres

import (
	"context"
	"database/sql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

func Rotate(ctx context.Context, event PostgresRotateParams) error {
	db, err := sql.Open("pgx", (&pgx.ConnConfig{
		Config: pgconn.Config{
			Host:     event.Host,
			Port:     uint16(event.Port),
			Database: event.Database,
			User:     event.ManagingUser.Username,
			Password: event.ManagingUser.Password,
		},
	}).ConnString())
	if err != nil {
		return err
	}
	defer db.Close()

	if _, err := db.ExecContext(ctx, `ALTER USER ? WITH PASSWORD ?`, event.RotateUser.Username, event.RotateUser.NewPassword); err != nil {
		return err
	}
	return nil
}
