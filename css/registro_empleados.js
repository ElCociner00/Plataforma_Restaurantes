/* ===============================
   FORM REGISTRO EMPLEADOS
   =============================== */

form {
  max-width: 520px;
}

/* Inputs generales */
input[type="text"],
input[type="password"],
input[type="date"] {
  width: 100%;
  padding: 10px;
  margin-bottom: 12px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
}

/* Username con dominio fijo */
.username-field {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.username-field input {
  flex: 1;
  border-radius: 6px 0 0 6px;
}

.username-field span {
  padding: 11px;
  background: #e5e7eb;
  border: 1px solid #d1d5db;
  border-left: none;
  border-radius: 0 6px 6px 0;
  font-size: 0.9rem;
  color: #374151;
}

/* Verificación NIT */
.nit-verificacion {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 0;
  font-size: 0.9rem;
}

/* Botón */
button[type="submit"] {
  margin-top: 12px;
}

/* Estado */
#status {
  margin-top: 10px;
  font-size: 0.9rem;
}
