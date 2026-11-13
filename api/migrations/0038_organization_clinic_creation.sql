-- Organization managers may provision working clinics through this narrow gate.
-- No direct runtime writes to clinics or bridge grants are enabled.
CREATE FUNCTION clinical_manage_clinics(hash bytea, request jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a jsonb; s sessions%ROWTYPE; original_clinic text; original_user text;
 master_value text; master_fingerprint text; principal app_users%ROWTYPE;
 source_roles jsonb; role_record jsonb; new_clinic uuid; new_unit uuid; new_user uuid; new_role uuid;
 code_value text; name_value text; zone_value text; created jsonb; result jsonb;
BEGIN
 a:=clinical_actor(hash);
 IF a IS NULL OR a->>'organization_id' IS NULL
 OR NOT coalesce((a->>'manage_organization')::boolean,false)
 OR NOT (a->'permissions' ?& ARRAY['roles:manage','masters:write']) THEN
  RETURN jsonb_build_object('success',false,'forbidden',true,'error','Organization management permission required');
 END IF;
 SELECT value#>>'{}' INTO master_value FROM org_settings WHERE unit_id IS NULL AND key='clinical_master_password';
 IF master_value IS NOT NULL THEN
  master_fingerprint:=encode(sha256(convert_to(master_value,'UTF8')),'hex');
  IF NOT clinical_master_is_unlocked(hash,master_fingerprint) THEN
   RETURN jsonb_build_object('success',false,'locked',true,'error','Unlock with the Master password to continue');
  END IF;
 END IF;
 original_clinic:=a->>'clinic_id'; original_user:=a->>'user_id';
 IF request IS NOT NULL THEN
  IF jsonb_typeof(request)<>'object' THEN RETURN jsonb_build_object('success',false,'error','Invalid clinic details'); END IF;
  code_value:=lower(trim(request->>'code')); name_value:=trim(request->>'name'); zone_value:=coalesce(nullif(trim(request->>'timezone'),''),a->>'timezone');
  IF coalesce(code_value,'') !~ '^[a-z0-9][a-z0-9-]{1,31}$' OR coalesce(name_value,'')='' OR length(name_value)>120
   OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone_value) THEN
   RETURN jsonb_build_object('success',false,'error','Enter a clinic name, a valid code and timezone');
  END IF;
  -- Serialize duplicate checks and provisioning within this organization's database.
  PERFORM id FROM org_identity WHERE id=(a->>'organization_id')::uuid FOR UPDATE;
  IF EXISTS(SELECT 1 FROM clinics WHERE code=code_value) OR EXISTS(SELECT 1 FROM org_units WHERE code=code_value) THEN
   RETURN jsonb_build_object('success',false,'error','Clinic code already exists; choose another code');
  END IF;
  SELECT jsonb_agg(jsonb_build_object('name',name,'permissions',permissions)) INTO source_roles FROM roles;
  SELECT * INTO s FROM sessions WHERE token_hash=hash;
  PERFORM set_config('app.clinic_id',s.clinic_id::text,true);
  SELECT * INTO principal FROM app_users WHERE id=s.user_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal account is unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO clinics(code,name,timezone) VALUES(code_value,name_value,zone_value) RETURNING id INTO new_clinic;
  INSERT INTO org_units(code,name) VALUES(code_value,name_value) RETURNING id INTO new_unit;
  INSERT INTO org_clinical_units(organization_id,unit_id,clinic_id) VALUES((a->>'organization_id')::uuid,new_unit,new_clinic);
  PERFORM set_config('app.clinic_id',new_clinic::text,true);
  PERFORM set_config('app.user_id','',true);
  FOR role_record IN SELECT * FROM jsonb_array_elements(source_roles) LOOP
   INSERT INTO roles(name,permissions) VALUES(role_record->>'name',ARRAY(SELECT jsonb_array_elements_text(role_record->'permissions'))) RETURNING id INTO new_role;
   IF role_record->>'name'=a->>'role' THEN
    INSERT INTO app_users(username,display_name,password_hash,role_id)
    VALUES(principal.username,principal.display_name,principal.password_hash,new_role) RETURNING id INTO new_user;
   END IF;
  END LOOP;
  IF new_user IS NULL THEN RAISE EXCEPTION 'Current role unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO org_clinical_access(organization_id,principal_clinic_id,principal_user_id,clinic_id,user_id,manage_organization)
  VALUES((a->>'organization_id')::uuid,s.clinic_id,s.user_id,new_clinic,new_user,true);
  PERFORM set_config('app.clinic_id',original_clinic,true);
  PERFORM set_config('app.user_id',original_user,true);
  INSERT INTO org_audit(actor_id,unit_id,action,subject_id) VALUES(s.user_id,new_unit,'clinical.clinic_created',new_clinic);
  created:=jsonb_build_object('id',new_clinic,'code',code_value,'name',name_value,'timezone',zone_value);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'timezone',c.timezone,'active',c.active) ORDER BY c.name),'[]')
 INTO result FROM clinics c JOIN org_clinical_units b ON b.clinic_id=c.id WHERE b.organization_id=(a->>'organization_id')::uuid;
 RETURN jsonb_build_object('success',true,'clinics',result,'created',created);
END $$;
REVOKE ALL ON FUNCTION clinical_manage_clinics(bytea,jsonb) FROM PUBLIC;
