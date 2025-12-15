import Joi from 'joi';
export declare const chatValidations: {
    chatCompletion: {
        headers: Joi.ObjectSchema<any>;
        query: Joi.ObjectSchema<any>;
        body: Joi.ObjectSchema<any>;
    };
};
