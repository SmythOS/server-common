import { NextFunction } from 'express';
import { ObjectSchema, Schema } from 'joi';
type SchemaObject = {
    body?: ObjectSchema<any> | Schema;
    query?: ObjectSchema<any> | Schema;
    params?: ObjectSchema<any> | Schema;
};
declare const validate: (schema: SchemaObject) => (req: any, _res: any, next: NextFunction) => void;
export { validate };
