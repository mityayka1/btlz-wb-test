import log4js from "log4js";

log4js.configure({
    appenders: {
        console: { type: "console" },
    },
    categories: {
        default: { appenders: ["console"], level: "info" },
    },
});

export const getLogger = log4js.getLogger.bind(log4js);
