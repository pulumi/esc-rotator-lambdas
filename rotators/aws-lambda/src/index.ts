import mysqlRotate from "./mysql";
import postgresRotate from "./postgres";

export const handler = async (event: any, context: any) => {
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
