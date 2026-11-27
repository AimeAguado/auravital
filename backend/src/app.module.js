const { Module } = require('@nestjs/common');
const { HealthController } = require('./health.controller');
const { AuthController } = require('./controllers/auth.controller');
const { ProfileController } = require('./controllers/profile.controller');
const { AccountController } = require('./controllers/account.controller');
const { ProfessionalsController } = require('./controllers/professionals.controller');
const { ReviewsController } = require('./controllers/reviews.controller');
const { AppointmentsController } = require('./controllers/appointments.controller');
const { AdminAppointmentsController } = require('./controllers/admin-appointments.controller');
const { ProfessionalController } = require('./controllers/professional.controller');
const { AdminProfessionalsController } = require('./controllers/admin-professionals.controller');
const { AdminController } = require('./controllers/admin.controller');

class AppModule {}

Module({ controllers: [HealthController, AuthController, ProfileController, AccountController, ProfessionalsController, ReviewsController, AppointmentsController, AdminAppointmentsController, ProfessionalController, AdminProfessionalsController, AdminController] })(AppModule);

module.exports = { AppModule };
