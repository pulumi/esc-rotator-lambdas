package mysql

import (
	"context"
	"fmt"
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
	db, err := sql.Open("mysql", (&mysql.Config{
		Addr:   fmt.Sprintf("%s:%d", request.Host, request.Port),
		DBName: request.Database,
		User:   request.ManagingUser.Username,
		Passwd: request.ManagingUser.Password,
	}).FormatDSN())
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `ALTER USER ? IDENTIFIED BY ?`, request.RotateUser.Username, request.RotateUser.NewPassword)
	if err != nil {
		return err
	}
	return nil
}
