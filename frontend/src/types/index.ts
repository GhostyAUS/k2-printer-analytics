export interface PrinterStats {
  result: {
    status: {
      print_stats?: {
        filename: string
        state: string
        print_duration: number
        total_duration: number
        filament_used: number
      }
      toolhead?: {
        position: number[]
        estimated_print_time: number
      }
      extruder?: {
        temperature: number
        target: number
        power: number
      }
      heater_bed?: {
        temperature: number
        target: number
        power: number
      }
      display_status?: {
        progress: number
      }
      virtual_sdcard?: {
        progress: number
        file_position: number
        file_size: number
        layer: number | null
        layer_count: number | null
        cur_print_data?: {
          start_time: number
          end_time: number
          metadata?: {
            estimated_time: number
            filament_used_g: string[]
            filament_type: string
          }
        }
      }
    }
    meta: {
      progress: number
      estimated_duration_seconds: number | null
      print_duration_seconds: number
      time_remaining_seconds: number | null
      layer: number | null
      layer_count: number | null
      estimated_filament_g: number | null
      start_timestamp: number | null
      end_timestamp: number | null
      filament_type: string | null
    }
  }
}

export interface PrintJob {
  id: number
  filename: string
  status: string
  start_time: string
  end_time: string | null
  estimated_duration_seconds: number | null
  actual_duration_seconds: number | null
  estimated_filament_g: number | null
  filament_used_g: number | null
  filament_length_mm: number | null
  total_power_kwh: number | null
  electricity_cost: number | null
  filament_cost: number | null
  filament_type: string | null
  spool_id: number | null
  created_at: string
  updated_at: string
}

export interface Spool {
  id: number
  brand: string
  material: string
  color: string
  initial_weight_g: number
  remaining_weight_g: number
  cost_per_kg: number | null
  created_at: string
  updated_at: string
}

export interface CfsSlot {
  slot: string
  tray: string
  position: string
  color_hex: string
  material_code: string
  material_name: string
  remaining_pct: number
  temperature: string | null
  humidity: string | null
  has_override?: boolean
  cost_per_kg?: number | null
  spool_weight_g?: number | null
  estimated_spool_cost?: number | null
}

export interface CfsSlotOverride {
  id?: number
  slot_id: string
  material_name?: string | null
  color_hex?: string | null
  remaining_pct?: number | null
  cost_per_kg?: number | null
  spool_weight_g?: number | null
}

export interface FilamentRoll {
  id: number
  created_at: string
  updated_at: string
  brand: string
  material: string
  color_name: string | null
  color_hex: string | null
  total_weight_g: number
  remaining_weight_g: number
  cost_per_kg: number | null
  purchase_date: string | null
  location: string | null
  notes: string | null
  spool_id: string | null
}
