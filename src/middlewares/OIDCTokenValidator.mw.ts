import axios from 'axios';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import qs from 'qs';

import { getAgentToken } from '@/helpers/auth.helper';
import { AuthRouteOptions, ProviderInfo } from '@/types/auth.types';

function isJWT(token: string): boolean {
    const parts = token.split('.');
    if (parts.length === 3) {
        try {
            const header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));

            // Optionally, check if header contains typical JWT properties
            if (header.alg && header.typ) {
                return true;
            }
        } catch (error) {
            // Errors in parsing mean this isn't a valid JWT
            return false;
        }
    }
    return false; // Not in JWT format if it doesn't have three parts
}

/**
 * Middleware to validate OIDC token
 * @param providerInfo - Provider information
 * @param bypass - Set it to true if you want to continue even if the token is not valid
 * @returns Express middleware function
 */

export default async function OIDCTokenValidatorMW(providerInfo: ProviderInfo, { bypass, checkHeaderForAuthToken }: AuthRouteOptions) {
    return async (req, res, next) => {
        const agentData = (req as any)._agentData;
        const agentId = agentData.id;

        try {
            const allowedEmails = (providerInfo.allowedEmails || []).filter((e: string) => e.trim());

            const openid: any = await axios.get(providerInfo.OIDCConfigURL).catch((error) => ({ error }));

            if (openid?.error) {
                console.error('OIDC:Error getting OIDC config', openid.error);
                if (bypass) {
                    return next();
                } else {
                    return res.status(401).send({ error: 'Validation Error: OIDC:Error getting OIDC config' });
                }
            }

            const oidcConfig = { openid: openid.data, clientID: providerInfo.clientID, clientSecret: providerInfo.clientSecret };

            // Extract token from request
            let token = getAgentToken(req, agentId);

            if (checkHeaderForAuthToken && req.headers['authorization']) {
                token = req.headers['authorization']?.split(' ')[1] || '';
            }

            if (!token) {
                if (bypass) {
                    return next();
                } else {
                    return res.status(401).json({ error: 'Validation Error: OIDC:Access token is required' });
                }
            }

            const isJWTToken = isJWT(token);

            // Middleware to validate an opaque access token using the token introspection endpoint
            const validateOpaqueToken = async (token: string) => {
                const auth = {
                    username: oidcConfig.clientID,
                    password: oidcConfig.clientSecret,
                };
                try {
                    // Send a POST request to the introspection endpoint
                    const response = await axios.post(
                        oidcConfig.openid.introspection_endpoint,
                        qs.stringify({
                            token: token,
                        }),
                        {
                            // Basic Auth with the client ID and client secret
                            auth,
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                        },
                    );

                    // The introspection response will contain a boolean "active" field indicating validity
                    if (response.data && response.data.active) {
                        try {
                            const userInfo = await axios.get(oidcConfig.openid.userinfo_endpoint, {
                                headers: {
                                    Authorization: `Bearer ${token}`,
                                },
                            });

                            if (allowedEmails.length > 0) {
                                const email = userInfo?.data?.email || '';
                                const domain = email.split('@')[1];
                                if (!allowedEmails.includes(email) && !allowedEmails.includes(domain)) {
                                    //the status code should be 403 here, but chatGPT goes in infinite loop if we use it.
                                    return { error: 'OIDC:User not allowed', status: 200 };
                                }
                            }

                            return { error: null };
                        } catch (error) {
                            return { error: 'OIDC:userinfo failed', status: 401 };
                        }
                    } else {
                        // Token is not active
                        return { error: 'OIDC:Agent Access token is invalid or expired', status: 401 };
                    }
                } catch (error) {
                    // Handle errors, such as network issues or the introspection endpoint being down
                    console.error('Token introspection error:', error);
                    return { error: 'Validation Error:Internal server error during token validation', status: 500 };
                }
            };

            const validateJWTToken = async (token: string) => {
                // Set up JWKS client using the JWKS URI from the OpenID configuration
                const jwks = jwksClient({
                    jwksUri: oidcConfig.openid.jwks_uri,
                });

                function getKey(header: any, callback: jwt.SigningKeyCallback) {
                    jwks.getSigningKey(header.kid, function (err, key: any) {
                        const signingKey = key?.publicKey || key?.rsaPublicKey;
                        callback(null, signingKey);
                    });
                }

                try {
                    const decoded = jwt.verify(token, getKey, {
                        algorithms: ['RS256'],
                    });

                    console.log(decoded);
                    return { error: null };
                } catch (err) {
                    return { error: 'OIDC:Invalid JWT token', status: 401 };
                }
            };

            // Validate token based on type
            let result: any;
            if (isJWTToken) {
                result = await validateJWTToken(token);
                if (result.error) {
                    if (bypass) {
                        return next();
                    } else {
                        return res.status(result.status).json({ error: result.error });
                    }
                }
            } else {
                result = await validateOpaqueToken(token);
                if (result.error) {
                    if (bypass) {
                        return next();
                    } else {
                        return res.status(result.status).json({ error: result.error });
                    }
                }
            }

            req._isSessionAuthorized = true;

            return next();
        } catch (error) {
            console.error('Error in OIDC Token Middleware:', error);
            if (bypass) {
                return next();
            } else {
                return res.status(500).send({ error: 'Validation Error:Internal server error during token validation' });
            }
        }
    };
}
