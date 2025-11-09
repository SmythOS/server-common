export function constructServerUrl(domain: string): string {
    const server_url_scheme =
        process.env.NODE_ENV === 'DEV' && process.env.AGENT_DOMAIN_PORT && domain.includes(process.env.AGENT_DOMAIN) ? 'http' : 'https';
    const server_url_port =
        process.env.NODE_ENV === 'DEV' && process.env.AGENT_DOMAIN_PORT && domain.includes(process.env.AGENT_DOMAIN)
            ? `:${process.env.AGENT_DOMAIN_PORT}`
            : '';
    return `${server_url_scheme}://${domain}${server_url_port}`;
}
