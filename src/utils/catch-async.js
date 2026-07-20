'use strict';

// Envolve controllers async e encaminha qualquer rejeição para o error-handler,
// eliminando try/catch repetitivo em cada controller.
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
