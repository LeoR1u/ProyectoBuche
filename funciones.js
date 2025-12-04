const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

// Configuración de la conexión a MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'bcagrdgj5ruymwal5qos-mysql.services.clever-cloud.com',
    user: process.env.DB_USER || 'urbrx6hekghrlift',
    password: process.env.DB_PASSWORD || 'yt3Qku0l89zYm1vb6uD7',
    database: process.env.DB_NAME || 'bcagrdgj5ruymwal5qos',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ========== USUARIOS ==========

async function registrarUsuario(nombre, email, password) {
    try {
        // Verificar si el email ya existe
        const [usuarios] = await pool.query('SELECT id FROM usuarios WHERE email = ?', [email]);
        if (usuarios.length > 0) {
            return { success: false, mensaje: 'El email ya está registrado' };
        }

        // Hash de la contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insertar usuario
        await pool.query(
            'INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)',
            [nombre, email, hashedPassword]
        );

        return { success: true, mensaje: 'Usuario registrado correctamente' };
    } catch (error) {
        console.error('Error al registrar usuario:', error);
        throw error;
    }
}

async function loginUsuario(email, password) {
    try {
        const [usuarios] = await pool.query(
            'SELECT id, nombre, email, password FROM usuarios WHERE email = ?',
            [email]
        );

        if (usuarios.length === 0) {
            return null;
        }

        const usuario = usuarios[0];
        const passwordValido = await bcrypt.compare(password, usuario.password);

        if (!passwordValido) {
            return null;
        }

        return {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email
        };
    } catch (error) {
        console.error('Error al hacer login:', error);
        throw error;
    }
}

// ========== PRODUCTOS ==========

async function obtenerProductos() {
    try {
        const [productos] = await pool.query(
            'SELECT * FROM productos ORDER BY fecha_creacion DESC'
        );
        return productos;
    } catch (error) {
        console.error('Error al obtener productos:', error);
        throw error;
    }
}

async function obtenerProductoPorId(id) {
    try {
        const [productos] = await pool.query('SELECT * FROM productos WHERE id = ?', [id]);
        return productos[0] || null;
    } catch (error) {
        console.error('Error al obtener producto:', error);
        throw error;
    }
}

// ========== CARRITO ==========

async function obtenerOCrearCarrito(usuarioId) {
    try {
        // Buscar carrito existente
        let [carritos] = await pool.query(
            'SELECT id FROM carritos WHERE usuario_id = ?',
            [usuarioId]
        );

        if (carritos.length === 0) {
            // Crear nuevo carrito
            const [result] = await pool.query(
                'INSERT INTO carritos (usuario_id) VALUES (?)',
                [usuarioId]
            );
            return result.insertId;
        }

        return carritos[0].id;
    } catch (error) {
        console.error('Error al obtener/crear carrito:', error);
        throw error;
    }
}

async function agregarAlCarrito(usuarioId, productoId) {
    try {
        const carritoId = await obtenerOCrearCarrito(usuarioId);

        // Verificar si el producto ya está en el carrito
        const [items] = await pool.query(
            'SELECT id, cantidad FROM carrito_items WHERE carrito_id = ? AND producto_id = ?',
            [carritoId, productoId]
        );

        if (items.length > 0) {
            // Incrementar cantidad
            await pool.query(
                'UPDATE carrito_items SET cantidad = cantidad + 1 WHERE id = ?',
                [items[0].id]
            );
        } else {
            // Agregar nuevo item
            await pool.query(
                'INSERT INTO carrito_items (carrito_id, producto_id, cantidad) VALUES (?, ?, 1)',
                [carritoId, productoId]
            );
        }
    } catch (error) {
        console.error('Error al agregar al carrito:', error);
        throw error;
    }
}

async function obtenerCarrito(usuarioId) {
    try {
        const carritoId = await obtenerOCrearCarrito(usuarioId);

        const [items] = await pool.query(`
            SELECT ci.id, ci.cantidad, p.id as producto_id, p.nombre, p.precio, p.imagen, p.stock
            FROM carrito_items ci
            JOIN productos p ON ci.producto_id = p.id
            WHERE ci.carrito_id = ?
        `, [carritoId]);

        return items;
    } catch (error) {
        console.error('Error al obtener carrito:', error);
        throw error;
    }
}

async function actualizarCantidadCarrito(itemId, cantidad) {
    try {
        if (cantidad <= 0) {
            await pool.query('DELETE FROM carrito_items WHERE id = ?', [itemId]);
        } else {
            await pool.query(
                'UPDATE carrito_items SET cantidad = ? WHERE id = ?',
                [cantidad, itemId]
            );
        }
    } catch (error) {
        console.error('Error al actualizar carrito:', error);
        throw error;
    }
}

async function eliminarDelCarrito(itemId) {
    try {
        await pool.query('DELETE FROM carrito_items WHERE id = ?', [itemId]);
    } catch (error) {
        console.error('Error al eliminar del carrito:', error);
        throw error;
    }
}

// ========== COMPRAS ==========

async function realizarCompra(usuarioId) {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();

        // Obtener items del carrito
        const carritoId = await obtenerOCrearCarrito(usuarioId);
        const [items] = await connection.query(`
            SELECT ci.cantidad, p.id as producto_id, p.precio, p.stock
            FROM carrito_items ci
            JOIN productos p ON ci.producto_id = p.id
            WHERE ci.carrito_id = ?
        `, [carritoId]);

        if (items.length === 0) {
            throw new Error('El carrito está vacío');
        }

        // Verificar stock
        for (const item of items) {
            if (item.stock < item.cantidad) {
                throw new Error(`No hay suficiente stock para el producto ${item.producto_id}`);
            }
        }

        // Calcular total
        const total = items.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);

        // Crear compra
        const [compraResult] = await connection.query(
            'INSERT INTO compras (usuario_id, total) VALUES (?, ?)',
            [usuarioId, total]
        );
        const compraId = compraResult.insertId;

        // Insertar detalles de compra y actualizar stock
        for (const item of items) {
            await connection.query(
                'INSERT INTO compra_detalles (compra_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
                [compraId, item.producto_id, item.cantidad, item.precio]
            );

            await connection.query(
                'UPDATE productos SET stock = stock - ? WHERE id = ?',
                [item.cantidad, item.producto_id]
            );
        }

        // Vaciar carrito
        await connection.query('DELETE FROM carrito_items WHERE carrito_id = ?', [carritoId]);

        await connection.commit();
        return compraId;
    } catch (error) {
        await connection.rollback();
        console.error('Error al realizar compra:', error);
        throw error;
    } finally {
        connection.release();
    }
}

async function obtenerCompra(compraId, usuarioId) {
    try {
        const [compras] = await pool.query(`
            SELECT c.id, c.total, c.fecha_compra, u.nombre as usuario_nombre
            FROM compras c
            JOIN usuarios u ON c.usuario_id = u.id
            WHERE c.id = ? AND c.usuario_id = ?
        `, [compraId, usuarioId]);

        if (compras.length === 0) {
            return null;
        }

        const compra = compras[0];

        const [detalles] = await pool.query(`
            SELECT cd.cantidad, cd.precio_unitario, p.nombre as producto_nombre
            FROM compra_detalles cd
            JOIN productos p ON cd.producto_id = p.id
            WHERE cd.compra_id = ?
        `, [compraId]);

        compra.detalles = detalles;
        return compra;
    } catch (error) {
        console.error('Error al obtener compra:', error);
        throw error;
    }
}

async function obtenerHistorialCompras(usuarioId) {
    try {
        const [compras] = await pool.query(`
            SELECT id, total, fecha_compra
            FROM compras
            WHERE usuario_id = ?
            ORDER BY fecha_compra DESC
        `, [usuarioId]);

        return compras;
    } catch (error) {
        console.error('Error al obtener historial:', error);
        throw error;
    }
}

// ========== PDF ==========

async function generarTicketPDF(compra) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfBuffer = Buffer.concat(buffers);
            resolve(pdfBuffer);
        });
        doc.on('error', reject);

        // Encabezado
        
        doc.fontSize(20).text('------------------------------------------', { align: 'center' });
        doc.fontSize(20).text('Lego Store', { align: 'center' });
        doc.fontSize(20).text('-------------------------------------------', { align: 'center' });
        doc.moveDown();
        doc.fontSize(20).text('TICKET', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`ID de Compra: ${compra.id}`);
        doc.text(`Cliente: ${compra.usuario_nombre}`);
        doc.text(`Fecha: ${new Date(compra.fecha_compra).toLocaleString()}`);
        doc.moveDown();

        // Línea separadora
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        // Detalles
        doc.fontSize(14).text('Productos:', { underline: true });
        doc.moveDown(0.5);

        compra.detalles.forEach(item => {
            doc.fontSize(10);
            doc.text(`${item.producto_nombre}`);
            doc.text(`  Cantidad: ${item.cantidad} x $${parseFloat (item.precio_unitario).toFixed(2)} = $${(item.cantidad * item.precio_unitario).toFixed(2)}`);
            doc.moveDown(0.5);
        });

        // Línea separadora
        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        // Total
        doc.fontSize(14).text(`TOTAL: $${parseFloat (compra.total).toFixed(2)}`, { align: 'right' });
        doc.moveDown(2);

        // Pie de página
        doc.fontSize(10).text('¡Gracias por su compra!', { align: 'center' });

        doc.end();
    });
}

module.exports = {
    registrarUsuario,
    loginUsuario,
    obtenerProductos,
    obtenerProductoPorId,
    agregarAlCarrito,
    obtenerCarrito,
    actualizarCantidadCarrito,
    eliminarDelCarrito,
    realizarCompra,
    obtenerCompra,
    obtenerHistorialCompras,
    generarTicketPDF
};
