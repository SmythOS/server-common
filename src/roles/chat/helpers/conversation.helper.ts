import { Conversation } from '@smythos/sdk/core';
import { Agent } from '@smythos/sdk';

//inject internal tools into the conversation
export function injectInternalTools(agent: Agent, conversation: Conversation) {
    conversation.addTool({
        name: 'process_attachment_fallback',
        description: 'Use this endpoint to process user queries with attachments, if there is no other endpoint to process the attachments.',
        arguments: {
            message: {
                name: 'message',
                type: 'string',
                description:
                    "The user's message without the attachments footer. The attachments will be passed as a second argument no need to pass their urls as part of this message.",
                required: true,
            },
            attachments: {
                name: 'attachments',
                type: 'array',
                description: 'The attachments to process. this should be an array of URIs, the URIs can use http or smythfs protocols',
                required: true,
            },
        },
        handler: async ({ message, attachments }: { message: string; attachments: string[] }) => {
            const llm = agent.llm.OpenAI('gpt-4o-mini', {
                credentials: ['vault', 'internal'],
            });

            //get default SRE storage with current agent scope
            const storage = agent.storage.default();

            const files = [];
            const texts = {};

            let documents = 0;
            for (const attachment of attachments) {
                const ext = attachment.split('.').pop().toLowerCase();
                if (ext === 'txt') {
                    const data = await storage.read(attachment);
                    const text = data.toString();
                    const url = new URL(attachment);
                    const filename = url.pathname.split('/').pop();
                    texts[filename] = text;
                    documents++;
                } else {
                    files.push(attachment);
                }
            }

            const prompt =
                'Analyze the user question and provide me with as much details as possible to help me answering him.\n' +
                `<user_question>\n${message}\n</user_question>\n\n` +
                (documents > 0 ? `<user_documents>\n${JSON.stringify(texts, null, 2)}\n</user_documents>\n\n` : '') +
                (files.length > 0
                    ? `####\nIf the attachments contain images describe themin clear details as you would do for a blind person, take into account the user question\n`
                    : '') +
                +'\n\n====\nProvide as much information as possible in a structured json format to help me give a detailed answer to the user\n' +
                'Expected output format: {"attachments": { "<name|id|random_uid>" : {"contextual_description": "detailled description that allows to answer the user question", "relevant_sections": "if the source is a document, provide the relevant sections of the document that are relevant to the user question", "additional_information": "any additional details about the attachment, even if they are not directly relevant to the user question but can help to answer it"}}}';

            const response = await llm.prompt(prompt, {
                files,
            });
            return response;
        },
    });
}
