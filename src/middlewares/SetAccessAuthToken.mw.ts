import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export function SetAccessAuthTokenMW(req: Request, res: Response, next: NextFunction) {
    try {
        const agentData = req._agentData;
        const agentId = agentData?.id;
        const teamId = agentData?.teamId;

        const token = jwt.sign(
            {
                agentId: agentId,
                teamId: teamId,
                exp: Math.floor(Date.now() / 1000) + 60, // 60 min expiry
            },
            process.env.INTERNAL_TRUSTED_SECRET, // Shared secret between services
            { algorithm: 'HS256' },
        );

        req.headers['x-auth-token'] = 'Bearer ' + token;
    } catch (error) {
        console.error('Error in SetAccessAuthTokenMW:', error);
    }
    return next();
}
