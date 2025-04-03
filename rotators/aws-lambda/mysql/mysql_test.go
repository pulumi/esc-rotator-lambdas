package mysql

import (
	"context"
	"database/sql"
	"fmt"
	_ "github.com/go-sql-driver/mysql"
	mysqltc "github.com/testcontainers/testcontainers-go/modules/mysql"
	"io"
	"path/filepath"
	"strconv"
	"testing"
)

// Create a temporary MySQL container and run the testdata/schema.sql migration to initialize it.
func setupDatabaseInstance(t *testing.T) (host string, port int) {
	t.Helper()
	ctx := context.Background()
	container, err := mysqltc.Run(ctx,
		"mysql:8.0.36",
		mysqltc.WithScripts(filepath.Join("testdata", "schema.sql")),
	)
	if err != nil {
		t.Log(fmt.Errorf("failed to start db: %w", err))
		logs, _ := container.Logs(ctx)
		buf, _ := io.ReadAll(logs)
		t.Log("container logs:\n", string(buf))
		t.FailNow()
	}
	t.Cleanup(func() {
		container.Terminate(ctx)
	})
	host, err = container.Host(ctx)
	if err != nil {
		t.Fatal(err)
	}
	containerPort, err := container.MappedPort(ctx, "3306/tcp")
	if err != nil {
		t.Fatal(err)
	}
	port, err = strconv.Atoi(containerPort.Port())
	if err != nil {
		t.Fatal(err)
	}
	return host, port
}

func TestRotate(t *testing.T) {
	host, port := setupDatabaseInstance(t)

	// Request a rotation
	newPassword := "new_password"
	err := Rotate(context.Background(), MysqlRotateParams{
		Host:     host,
		Port:     port,
		Database: "credential_rotation_test",
		ManagingUser: MysqlUser{
			Username: "managing_user",
			Password: "manager_password",
		},
		RotateUser: MysqlUser{
			Username:    "target_user",
			Password:    "initial_password",
			NewPassword: &newPassword,
		},
	})
	if err != nil {
		t.Fatal(fmt.Errorf("rotation request failed: %w", err))
	}

	// Verify rotation succeeded by attempting to log in with the new password
	db, err := sql.Open("mysql", fmt.Sprintf("%s:%s@tcp(%s:%d)/%s", "target_user", newPassword, host, port, "credential_rotation_test"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.Ping(); err != nil {
		t.Fatal(err)
	}
}
