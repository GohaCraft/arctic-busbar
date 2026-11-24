const p = plugin.packet;
if (p.temp > plugin.params.temp_limit_c) return { alarm: true, note: "hot " + p.temp.toFixed(1) };
return { alarm: false };
