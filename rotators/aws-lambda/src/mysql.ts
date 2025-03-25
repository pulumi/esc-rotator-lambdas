import mysql from "mysql2/promise";

export interface MysqlRotateParams {
    type: "mysql";
    host: string;
    port: number;
    database: string;

    managingUser: MysqlUser;
    rotateUser: MysqlUser;
}

interface MysqlUser {
    username: string;
    password: string;
    newPassword?: string;
}

export default async function rotate(event: MysqlRotateParams) {
    let statusCode = 200;
    let message = "ok";

    const { database, host, port, managingUser, rotateUser } = event;
    const { username: managingUsername, password: managingPassword } = managingUser;
    const { username: rotateUsername, newPassword: newPassword } = rotateUser;

    if (!newPassword) {
        return {
            code: 400,
            message: "No new password provided",
        }
    }

    try {
        const connection = await mysql.createConnection({
            host: host,
            port: port,
            database: database,
            user: managingUsername,
            password: managingPassword,
        });

        const query = "ALTER USER ? IDENTIFIED BY ?";
        await connection.query(query, [rotateUsername, newPassword]);
    } catch (error) {
        statusCode = 400;
        message = `Error rotating user '${rotateUsername}': ${error}`;
    }

    return {
        code: statusCode,
        message: message,
    }
}
