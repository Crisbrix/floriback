//Convierte ventas (incluida la descomposición de pagos combinados) en montos por método.
//Una venta combinada guarda metodo_pago='combinado' y detalles_pago=[{metodo,monto},...]
//en la primera fila del grupo. Aquí se expande cada tramo a su método real.
export function expandirMetodos(rows) {
  const map = new Map();
  const seenGrupo = new Set();
  for (const r of rows) {
    const metodo = r.metodo_pago;
    if (metodo === 'combinado' && r.detalles_pago && r.grupo_id) {
      if (seenGrupo.has(r.grupo_id)) continue;
      seenGrupo.add(r.grupo_id);
      let legs = [];
      try { legs = JSON.parse(r.detalles_pago); } catch { legs = []; }
      for (const leg of legs) {
        const m = map.get(leg.metodo) || { cantidad: 0, total: 0 };
        m.cantidad += 1;
        m.total += Number(leg.monto) || 0;
        map.set(leg.metodo, m);
      }
    } else {
      const m = map.get(metodo) || { cantidad: 0, total: 0 };
      m.cantidad += 1;
      m.total += Number(r.total) || 0;
      map.set(metodo, m);
    }
  }
  return Array.from(map.entries()).map(([metodo_pago, v]) => ({ metodo_pago, ...v }));
}
