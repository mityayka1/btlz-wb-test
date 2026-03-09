/** Базовый класс доменных ошибок приложения. */
export class AppError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class NotFoundError extends AppError {
    constructor(message: string) {
        super(message, 404);
    }
}

export class DuplicateError extends AppError {
    constructor(message: string) {
        super(message, 409);
    }
}

export class AccessDeniedError extends AppError {
    constructor(message: string) {
        super(message, 403);
    }
}

export class ValidationError extends AppError {
    constructor(message: string) {
        super(message, 400);
    }
}

export class ExternalServiceError extends AppError {
    constructor(message: string) {
        super(message, 502);
    }
}
