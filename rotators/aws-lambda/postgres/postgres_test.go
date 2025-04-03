package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	postgrestc "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// Create a temporary Postgres container and run the testdata/schema.sql migration to initialize it.
func setupDatabaseInstance(t *testing.T) (host string, port int) {
	t.Helper()
	ctx := context.Background()
	container, err := postgrestc.Run(ctx,
		"postgres:16-alpine",
		postgrestc.WithInitScripts(filepath.Join("testdata", "schema.sql")),
		// see https://golang.testcontainers.org/modules/postgres/#wait-strategies_1
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").WithOccurrence(2),
			wait.ForListeningPort("5432/tcp"),
		),
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
	containerPort, err := container.MappedPort(ctx, "5432/tcp")
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
	err := Rotate(context.Background(), PostgresRotateParams{
		Host:     host,
		Port:     port,
		Database: "credential_rotation_test",
		ManagingUser: PostgresUser{
			Username: "managing_user",
			Password: "manager_password",
		},
		RotateUser: PostgresUser{
			Username:    "target_user",
			Password:    "initial_password",
			NewPassword: &newPassword,
		},
	})
	if err != nil {
		t.Fatal(fmt.Errorf("rotation request failed: %w", err))
	}

	// Verify rotation succeeded by attempting to log in with the new password
	db, err := sql.Open("postgres", fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable", "target_user", newPassword, host, port, "credential_rotation_test"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.Ping(); err != nil {
		t.Fatal(err)
	}
}
