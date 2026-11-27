const REDACTED_MONGO = /mongodb(?:\+srv)?:\/\/[^@/]+@/gi;

class ApiErrorFilter {
  catch(exception, host) {
    const http = host.switchToHttp();
    const res = http.getResponse();
    const req = http.getRequest();
    const status = Number(exception?.status) || Number(exception?.statusCode) || 500;
    if (status >= 500) console.error(`${exception?.name || 'Error'}: ${String(exception?.message || '').replace(REDACTED_MONGO, 'mongodb://***@').slice(0, 300)}`);
    let message = status >= 500 ? 'Ocurrió un error interno. Intentá nuevamente.' : String(exception?.message ?? '');
    if (status === 404 && String(req.path || '').startsWith('/api')) message = 'Ruta de API no encontrada.';
    res.status(status).json({ error: message });
  }
}

module.exports = { ApiErrorFilter };
