export async function handler(event: any){
    console.log('Event:', event);

    const name = event.name || 'Guest';

    const message = `Hello, ${name}!`;

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: message,
        }),
    };
}
