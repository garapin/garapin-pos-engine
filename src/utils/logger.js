class Logger {
    static log(message, type = 'INFO') {
        const colors = {
            'INFO': '\x1b[32m', // Hijau
            'ERROR': '\x1b[31m', // Merah
            'WARN': '\x1b[33m' // Kuning
        };
        const color = colors[type] || '\x1b[37m'; // Putih sebagai default
        console.log(`${color}[${type}] ${new Date().toISOString()} - ${message}\x1b[0m`);
    }

    static errorLog(message, error) {
        Logger.log(`${message}: ${error}`, 'ERROR');
    }
}

export default Logger;