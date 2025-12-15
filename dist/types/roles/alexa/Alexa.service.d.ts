export declare function handleAlexaRequest({ isEnabled, model, alexRequest, agentData, serverOrigin, }: {
    isEnabled: boolean;
    model: string;
    alexRequest: any;
    agentData: any;
    serverOrigin: string;
}): Promise<{
    version: string;
    sessionAttributes: {};
    response: {
        outputSpeech: {
            type: string;
            text: string;
        };
        reprompt: {
            outputSpeech: {
                type: string;
                text: string;
            };
        };
        shouldEndSession: boolean;
    };
}>;
export declare function parseAlexaRequest(alexRequest: any): {
    type: any;
    intent: any;
    slots: {};
};
export declare function getSlotValues(filledSlots: any): {};
export declare function buildAlexaResponse(outputSpeech: string, reprompt?: string, shouldEndSession?: boolean): {
    version: string;
    sessionAttributes: {};
    response: {
        outputSpeech: {
            type: string;
            text: string;
        };
        reprompt: {
            outputSpeech: {
                type: string;
                text: string;
            };
        };
        shouldEndSession: boolean;
    };
};
export declare function createAlexaSkill(agentName: string, accessToken: string, vendorId: string, endpoint: string): Promise<any>;
export declare function processAlexaSearchQuery({ query, model, agentData, serverOrigin, }: {
    query: string;
    model: string;
    agentData: any;
    serverOrigin: string;
}): Promise<string>;
export declare function isAlexaEnabled(agentData: any, agentSettings: any): boolean;
