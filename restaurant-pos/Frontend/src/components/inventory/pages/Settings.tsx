import { useState } from 'react';
import { Save, Bell, Mic, Package, Sliders } from 'lucide-react';
import { motion } from 'motion/react';
import { DEFAULT_INVENTORY_SETTINGS } from '../data';
import type { InventorySettings } from '../types';
import { useNotify } from '../InventoryManager';

export default function SettingsPage() {
  const notify = useNotify();
  const [settings, setSettings] = useState<InventorySettings>(DEFAULT_INVENTORY_SETTINGS);

  const toggle = (key: 'enableVoiceEntry' | 'enableNotifications') => {
    setSettings(s => ({ ...s, [key]: !s[key] }));
  };

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-xs text-gray-400 mt-0.5">Configure your preferences</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
        <div className="bg-[var(--color-bg-white)] rounded-2xl border border-[var(--color-border-default)] divide-y divide-[var(--color-border-default)] shadow-sm">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><Package className="w-5 h-5 text-blue-600" /></div>
              <div><p className="text-sm font-bold">General</p><p className="text-xs text-gray-400">Inventory defaults</p></div>
            </div>
            <div className="space-y-5">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Low Stock Alert at</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={settings.lowStockThreshold} onChange={e => setSettings(s => ({ ...s, lowStockThreshold: Number(e.target.value) }))}
                    className="w-24 px-4 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                  />
                  <span className="text-sm text-gray-500">% of min stock</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Default Supplier</label>
                <input type="text" value={settings.defaultSupplier} onChange={e => setSettings(s => ({ ...s, defaultSupplier: e.target.value }))}
                  placeholder="Supplier name"
                  className="w-full px-4 py-2.5 rounded-xl border border-[var(--color-border-input)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/20 focus:border-[var(--brand-color)]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Units</label>
                <div className="flex flex-wrap gap-1.5">
                  {settings.units.map(unit => (
                    <span key={unit} className="px-3 py-1.5 bg-gray-50 border border-[var(--color-border-default)] rounded-xl text-xs font-semibold text-gray-600">{unit}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"><Sliders className="w-5 h-5 text-amber-600" /></div>
              <div><p className="text-sm font-bold">Features</p><p className="text-xs text-gray-400">Toggle features on/off</p></div>
            </div>
            <div className="space-y-4">
              {[
                { icon: Mic, label: 'Voice Entry', key: 'enableVoiceEntry' as const },
                { icon: Bell, label: 'Notifications', key: 'enableNotifications' as const },
              ].map(item => {
                const Icon = item.icon;
                const isOn = settings[item.key];
                return (
                  <div key={item.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-semibold">{item.label}</span>
                    </div>
                    <button onClick={() => toggle(item.key)}
                      className={`relative w-12 h-6 rounded-full transition-all cursor-pointer ${isOn ? 'bg-[var(--brand-color)]' : 'bg-gray-200'}`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 bg-[var(--color-bg-white)] rounded-full shadow-sm transition-all ${isOn ? 'left-6' : 'left-0.5'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <button onClick={() => notify('Settings saved', 'success')} className="w-full py-3.5 bg-[var(--brand-color)] hover:bg-[var(--color-primary-hover)] text-white rounded-2xl text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-sm">
          <Save className="w-4 h-4" /> Save Settings
        </button>
      </motion.div>
    </div>
  );
}