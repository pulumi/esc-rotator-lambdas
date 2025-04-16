package mysql

import (
	"context"
	"fmt"
	"net"

	"github.com/go-sql-driver/mysql"
)
import "database/sql"

type MysqlRotateParams struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`

	ManagingUser MysqlUser `json:"managingUser"`
	RotateUser   MysqlUser `json:"rotateUser"`
}

type MysqlUser struct {
	Username    string  `json:"username"`
	Password    string  `json:"password"`
	NewPassword *string `json:"newPassword"`
}

func Rotate(ctx context.Context, request MysqlRotateParams) error {
	if request.RotateUser.NewPassword == nil {
		return fmt.Errorf("no password provided")
	}

	db, err := sql.Open("mysql", (&mysql.Config{
		Net:               "tcp",
		Addr:              net.JoinHostPort(request.Host, fmt.Sprintf("%d", request.Port)),
		DBName:            request.Database,
		User:              request.ManagingUser.Username,
		Passwd:            request.ManagingUser.Password,
		InterpolateParams: true,
	}).FormatDSN())
	if err != nil {
		return err
	}
	defer db.Close()

	if err = db.PingContext(ctx); err != nil {
		return fmt.Errorf("connecting to database: %w", err)
	}

	_, err = db.ExecContext(ctx, `ALTER USER ? IDENTIFIED BY ?`, request.RotateUser.Username, request.RotateUser.NewPassword)
	if err != nil {
		return fmt.Errorf("error rotating user %q: %w", request.RotateUser.Username, err)
	}
	return nil
}
