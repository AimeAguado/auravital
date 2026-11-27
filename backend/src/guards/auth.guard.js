const { ForbiddenException, UnauthorizedException } = require('@nestjs/common');

class AuthGuard {
  canActivate(context) {
    const req = context.switchToHttp().getRequest();
    if (!req.user) throw new UnauthorizedException('Iniciá sesión para continuar.');
    return true;
  }
}

class RolesGuard {
  constructor(...roles) {
    this.roles = roles;
  }

  canActivate(context) {
    const req = context.switchToHttp().getRequest();
    if (!req.user) throw new UnauthorizedException('Iniciá sesión para continuar.');
    if (!this.roles.includes(req.user.role)) throw new ForbiddenException('No tenés permisos para realizar esta acción.');
    return true;
  }
}

module.exports = { AuthGuard, RolesGuard };
