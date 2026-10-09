// Preview-only stand-in for the gateway client's browser entry. BrowserView never calls it in the fixture.
export class GatewayBrowserClient {}
export const createGatewayBrowserClient = () => new GatewayBrowserClient();
export default {};
