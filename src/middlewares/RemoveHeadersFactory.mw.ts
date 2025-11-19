//This middleware is used on agent servers because they are not supposed to handle debug requests

export default function RemoveHeadersFactory(headers: string[]) {
    return (req, res, next) => {
        headers.forEach((header) => {
            if (req.headers[header]) {
                delete req.headers[header];
            }
        });
        return next();
    };
}
