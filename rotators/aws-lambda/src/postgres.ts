import pg from "pg"

export interface PostgresRotateParams {
    type: "postgres";
    host: string;
    port: number;
    database: string;

    managingUser: PostgresUser;
    rotateUser: PostgresUser;
}

interface PostgresUser {
    username: string;
    password: string;
    newPassword?: string;
}

export default async function rotate(event: PostgresRotateParams) {
    let statusCode = 200;
    let message = "ok";

    const { database, host, port, managingUser, rotateUser } = event;
    const { username: managingUsername, password: managingPassword } = managingUser;
    const { username: rotateUsername, newPassword: newPassword } = rotateUser;

    const { Client, escapeIdentifier, escapeLiteral } = pg;

    if (!newPassword) {
        return {
            code: 400,
            message: "No new password provided",
        }
    }

    try {
        const client = new Client({
            user: managingUsername,
            password: managingPassword,
            host: host,
            port: port,
            database: database,
        })
        await client.connect();

        const query = `ALTER USER ${escapeIdentifier(rotateUsername)} WITH PASSWORD ${escapeLiteral(newPassword)}`;
        await client.query(query);

        await client.end();
    } catch (error) {
        statusCode = 400;
        message = `Error rotating user '${rotateUsername}': ${error}`;
    }

    return {
        code: statusCode,
        message: message,
    }
}
