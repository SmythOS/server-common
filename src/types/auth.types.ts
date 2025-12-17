export interface ProviderInfo {
    method: string;
    provider: string;
    clientID: string;
    clientSecret: string;
    redirectURI: string;
    authorizationURL: string;
    OIDCConfigURL: string;
    allowedEmails: string[];
    token: string;
}
export interface AuthRouteOptions {
    responseType?: 'html' | 'json';
    bypass?: boolean;
    checkHeaderForAuthToken?: boolean;
}
