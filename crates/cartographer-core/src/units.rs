//! Sub-cell coordinate system.
//!
//! Coordinates are stored as `i32` in **twelfths of a cell**. Base 12 = 2² × 3
//! means halves, thirds, quarters, sixths, and twelfths are all exact
//! integers — no floating-point drift, and equality comparisons stay
//! meaningful.
//!
//! YAML/JSON read or write the value in **whole-cell units**: integers when
//! the coord lands on a cell boundary, decimals otherwise (e.g. `2.5` for
//! half-cell, `3.333…` rounds to `1/3 cell` = `4` twelfths). Anything between
//! two representable subdivisions is rounded to the nearest twelfth.

use schemars::JsonSchema;
use schemars::schema::{Schema, SchemaObject};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Subdivisions per cell. 12 is the smallest integer divisible by 2, 3, 4, 6.
pub const UNITS_PER_CELL: i32 = 12;

/// A coordinate component in 1/12-cell units.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct C(pub i32);

impl C {
    pub const ZERO: C = C(0);
    pub const ONE_CELL: C = C(UNITS_PER_CELL);

    pub const fn cells(n: i32) -> Self {
        C(n * UNITS_PER_CELL)
    }
    pub const fn units(n: i32) -> Self {
        C(n)
    }
    pub fn as_cells(self) -> f64 {
        self.0 as f64 / UNITS_PER_CELL as f64
    }
    pub fn units_i32(self) -> i32 {
        self.0
    }
}

impl std::ops::Add for C {
    type Output = C;
    fn add(self, rhs: C) -> C { C(self.0 + rhs.0) }
}
impl std::ops::Sub for C {
    type Output = C;
    fn sub(self, rhs: C) -> C { C(self.0 - rhs.0) }
}

impl Serialize for C {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        if self.0 % UNITS_PER_CELL == 0 {
            s.serialize_i32(self.0 / UNITS_PER_CELL)
        } else {
            s.serialize_f64(self.as_cells())
        }
    }
}

impl<'de> Deserialize<'de> for C {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        // Accept both integer and floating-point YAML values.
        let cells = f64::deserialize(d)?;
        if !cells.is_finite() {
            return Err(serde::de::Error::custom("coordinate must be finite"));
        }
        let units = (cells * UNITS_PER_CELL as f64).round() as i32;
        Ok(C(units))
    }
}

impl JsonSchema for C {
    fn schema_name() -> String {
        "CellCoord".to_owned()
    }
    fn json_schema(_: &mut schemars::SchemaGenerator) -> Schema {
        // Authored as a number in whole-cell units. Sub-cell positions are
        // rounded to the nearest twelfth on read.
        let mut s = SchemaObject::default();
        s.instance_type = Some(schemars::schema::InstanceType::Number.into());
        s.metadata().description = Some(
            "Coordinate in whole-cell units. Sub-cell positions are rounded \
             to the nearest 1/12 cell on read (so halves, thirds, quarters, \
             sixths, and twelfths are exact)."
                .into(),
        );
        Schema::Object(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_cell_round_trip() {
        let c = C::cells(5);
        let yaml = serde_yaml::to_string(&c).unwrap();
        assert_eq!(yaml.trim(), "5");
        let back: C = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn half_cell_round_trip() {
        let c = C(6); // 0.5 cells
        let yaml = serde_yaml::to_string(&c).unwrap();
        assert_eq!(yaml.trim(), "0.5");
        let back: C = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn third_cell_rounds_to_four_twelfths() {
        let c: C = serde_yaml::from_str("0.3333333333").unwrap();
        assert_eq!(c, C(4), "1/3 cell rounds to 4 twelfths");
    }

    #[test]
    fn arbitrary_decimal_snaps_to_nearest_twelfth() {
        let c: C = serde_yaml::from_str("0.6").unwrap();
        // 0.6 * 12 = 7.2 → rounds to 7 → 7/12 ≈ 0.583
        assert_eq!(c, C(7));
    }
}
