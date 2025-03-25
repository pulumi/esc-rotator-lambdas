import mysqlRotate, { MysqlRotateParams } from "./mysql";
import postgresRotate, { PostgresRotateParams } from "./postgres";

type Event = MysqlRotateParams | PostgresRotateParams | any;

export const handler = async (event: Event, context: any) => {
    if (event.type === "mysql") {
        return mysqlRotate(event);
    } else if (event.type === "postgres") {
        return postgresRotate(event);
    }

    return {
        code: 400,
        message: `Unknown event type: "${event.type}"`,
    };
};
