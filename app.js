require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const funciones = require('./funciones');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || 'mi-secreto-super-seguro',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure:false,
        maxAge: 1000 * 60 * 60 * 24 // 24 horas
    }
}));

// Middleware para pasar el usuario a todas las vistas
app.use((req, res, next) => {
    res.locals.usuario = req.session.usuario || null;
    next();
});

// Middleware para proteger rutas
const requiereAuth = (req, res, next) => {
  if (req.session.usuario) {
    next(); // Usuario autenticado, continuar
  } else {  
    res.redirect('/login'); // Redirigir al login si no está autenticado
  }
};

// =============== RUTAS ===============

// Página principal - Mostrar todos los productos
app.get('/', async (req, res) => {
    try {
        const productos = await funciones.obtenerProductos();
        res.render('index', { productos });
    } catch (error) {
        res.status(500).send('Error al cargar productos');
    }
});

// Página de login
app.get('/login', (req, res) => {
    if (req.session.usuario) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
});

// Procesar login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const usuario = await funciones.loginUsuario(email, password);
        if (usuario) {
            req.session.usuario = usuario;
            res.redirect('/');
        } else {
            res.render('login', { error: 'Email o contraseña incorrectos' });
        }
    } catch (error) {
        res.render('login', { error: 'Error al iniciar sesión' });
    }
});

// Página de registro
app.get('/registro', (req, res) => {
    if (req.session.usuario) {
        return res.redirect('/');
    }
    res.render('registro', { error: null });
});

// Procesar registro
app.post('/registro', async (req, res) => {
    const { nombre, email, password } = req.body;
    try {
        const resultado = await funciones.registrarUsuario(nombre, email, password);
        if (resultado.success) {
            res.redirect('/login');
        } else {
            res.render('registro', { error: resultado.mensaje });
        }
    } catch (error) {
        res.render('registro', { error: 'Error al registrar usuario' });
    }
});

// Cerrar sesión
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Ver carrito
app.get('/carrito', requiereAuth, async (req, res) => {
    try {
        const items = await funciones.obtenerCarrito(req.session.usuario.id);
        const total = items.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
        res.render('carrito', { items, total });
    } catch (error) {
        res.status(500).send('Error al cargar el carrito');
    }
});

// Agregar al carrito
app.post('/carrito/agregar', requiereAuth, async (req, res) => {
    const { producto_id } = req.body;
    try {
        await funciones.agregarAlCarrito(req.session.usuario.id, producto_id);
        res.redirect('/carrito');
    } catch (error) {
        res.status(500).send('Error al agregar al carrito');
    }
});

// Actualizar cantidad en carrito
app.post('/carrito/actualizar', requiereAuth, async (req, res) => {
    const { item_id, cantidad } = req.body;
    try {
        await funciones.actualizarCantidadCarrito(item_id, cantidad);
        res.redirect('/carrito');
    } catch (error) {
        res.status(500).send('Error al actualizar el carrito');
    }
});

// Eliminar del carrito
app.post('/carrito/eliminar', requiereAuth, async (req, res) => {
    const { item_id } = req.body;
    try {
        await funciones.eliminarDelCarrito(item_id);
        res.redirect('/carrito');
    } catch (error) {
        res.status(500).send('Error al eliminar del carrito');
    }
});

// Realizar compra
app.post('/comprar', requiereAuth, async (req, res) => {
    try {
        const compraId = await funciones.realizarCompra(req.session.usuario.id);
        res.redirect(`/compra/${compraId}`);
    } catch (error) {
        res.status(500).send('Error al realizar la compra: ' + error.message);
    }
});

// Ver ticket de compra
app.get('/compra/:id', requiereAuth, async (req, res) => {
    try {
        const compra = await funciones.obtenerCompra(req.params.id, req.session.usuario.id);
        if (!compra) {
            return res.status(404).send('Compra no encontrada');
        }
        res.render('ticket', { compra });
    } catch (error) {
        res.status(500).send('Error al cargar la compra');
    }
});

// Descargar ticket en PDF
app.get('/compra/:id/pdf', requiereAuth, async (req, res) => {
  try {
    console.log('Generando PDF para compra:', req.params.id);
    
    const compra = await funciones.obtenerCompra(req.params.id, req.session.usuario.id);
    if (!compra) {
      return res.status(404).send('Compra no encontrada');
    }

    console.log('Datos de compra obtenidos:', compra);
    
    const pdfBuffer = await funciones.generarTicketPDF(compra);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=ticket-${compra.usuario_nombre}-${compra.id}.pdf`);
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send(`Error al generar el PDF: ${error.message}`);
  }
});

// Historial de compras
app.get('/historial', requiereAuth, async (req, res) => {
    try {
        const compras = await funciones.obtenerHistorialCompras(req.session.usuario.id);
        res.render('historial', { compras });
    } catch (error) {
        res.status(500).send('Error al cargar el historial');
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});